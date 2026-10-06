import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { BuildConfig } from '../../../types/build';
import {
	createOptionalPeerPlugin,
	resolveServerBundleExternals
} from '../../../src/cli/serverBundleExternals';

const config = (input: Partial<BuildConfig>) => input as BuildConfig;

describe('server bundle externals', () => {
	test('applies user externals consistently to production server bundles', () => {
		expect(
			resolveServerBundleExternals(
				config({ bunBuild: { external: ['cpu-features'] } })
			)
		).toContain('cpu-features');
		expect(
			resolveServerBundleExternals(
				config({
					bunBuild: {
						default: { external: ['optional-native-addon'] }
					}
				})
			)
		).toContain('optional-native-addon');
	});

	test('bundles configured framework runtimes and externalizes absent ones', () => {
		const externals = resolveServerBundleExternals(
			config({ reactDirectory: 'src/react' })
		);

		expect(externals).not.toContain('react');
		expect(externals).not.toContain('react-dom');
		expect(externals).toContain('vue');
		expect(externals).toContain('svelte');
	});
});

describe('optional peers', () => {
	/* An app depending on `dep-a`, whose module imports `peer-x`, an
	 * optional peer of `dep-a`. Where `peer-x` is installed decides whether
	 * the server bundle inlines it or leaves the import bare. */
	const project = async (peerAt: 'absent' | 'beside' | 'root') => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-optional-peers-'));
		const write = async (file: string, value: string) => {
			await mkdir(join(root, file, '..'), { recursive: true });
			await writeFile(join(root, file), value);
		};
		await write(
			'package.json',
			JSON.stringify({ dependencies: { 'dep-a': '1.0.0' } })
		);
		await write(
			'node_modules/dep-a/package.json',
			JSON.stringify({
				main: 'index.js',
				name: 'dep-a',
				peerDependencies: { 'peer-required': '*', 'peer-x': '*' },
				peerDependenciesMeta: { 'peer-x': { optional: true } }
			})
		);
		await write(
			'node_modules/dep-a/index.js',
			"import { x } from 'peer-x';\nexport const y = x;\n"
		);
		const peerModule = "export const x = 'PEER_X_MARKER';\n";
		const peerManifest = JSON.stringify({
			main: 'index.js',
			name: 'peer-x'
		});
		// `beside` is Bun's isolated layout: linked next to the dependency
		// that declares it, not at the project root.
		const peerDirectory =
			peerAt === 'root'
				? 'node_modules/peer-x'
				: 'node_modules/dep-a/node_modules/peer-x';
		if (peerAt !== 'absent') {
			await write(`${peerDirectory}/package.json`, peerManifest);
			await write(`${peerDirectory}/index.js`, peerModule);
		}
		await write(
			'entry.ts',
			"import { y } from 'dep-a';\nconsole.log(y);\n"
		);

		return root;
	};
	const bundle = async (root: string) => {
		const result = await Bun.build({
			entrypoints: [join(root, 'entry.ts')],
			plugins: [createOptionalPeerPlugin(root)],
			target: 'bun',
			throw: false
		});

		return { code: (await result.outputs[0]?.text()) ?? '', result };
	};

	test('leaves an optional peer the app did not install external', async () => {
		const { code, result } = await bundle(await project('absent'));

		expect(result.success).toBe(true);
		expect(code).toContain('from "peer-x"');
	});

	test('bundles an optional peer installed at the project root', async () => {
		const { code } = await bundle(await project('root'));

		expect(code).toContain('PEER_X_MARKER');
		expect(code).not.toContain('from "peer-x"');
	});

	test('bundles an optional peer linked beside its dependency', async () => {
		// The isolated-install case that left @neondatabase/serverless and
		// zod external in production and crashed the server at startup.
		const { code } = await bundle(await project('beside'));

		expect(code).toContain('PEER_X_MARKER');
		expect(code).not.toContain('from "peer-x"');
	});

	test('never treats a required peer, or other packages, as optional', () => {
		expect(resolveServerBundleExternals(config({}))).not.toContain(
			'peer-required'
		);
		expect(resolveServerBundleExternals(config({}))).not.toContain(
			'elysia'
		);
	});
});
