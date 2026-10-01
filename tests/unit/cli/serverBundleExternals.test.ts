import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { BuildConfig } from '../../../types/build';
import { resolveServerBundleExternals } from '../../../src/cli/serverBundleExternals';

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

describe('missing optional peers', () => {
	const project = async (installed: string[]) => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-optional-peers-'));
		const write = async (file: string, value: unknown) => {
			await mkdir(join(root, file, '..'), { recursive: true });
			await writeFile(join(root, file), JSON.stringify(value));
		};
		await write('package.json', {
			dependencies: { '@absolutejs/auth': '0.83.0' }
		});
		await write('node_modules/@absolutejs/auth/package.json', {
			peerDependencies: {
				'@node-saml/node-saml': '>=5.1.0 <6',
				elysia: '*'
			},
			peerDependenciesMeta: {
				'@node-saml/node-saml': { optional: true }
			}
		});
		await Promise.all(
			installed.map((name) =>
				write(`node_modules/${name}/package.json`, { name })
			)
		);

		return root;
	};

	test('leaves an optional peer the app did not install external', async () => {
		const root = await project([]);

		expect(resolveServerBundleExternals(config({}), root)).toEqual(
			expect.arrayContaining([
				'@node-saml/node-saml',
				'@node-saml/node-saml/*'
			])
		);
	});

	test('bundles an optional peer the app installed', async () => {
		const root = await project(['@node-saml/node-saml']);

		expect(resolveServerBundleExternals(config({}), root)).not.toContain(
			'@node-saml/node-saml'
		);
	});

	test('never externalizes a required peer', async () => {
		const root = await project([]);

		expect(resolveServerBundleExternals(config({}), root)).not.toContain(
			'elysia'
		);
	});
});
