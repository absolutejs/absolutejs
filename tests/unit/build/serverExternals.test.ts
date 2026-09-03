import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createDevServerExternalResolver,
	createDevServerExternalsPlugin,
	packageNameOf
} from '../../../src/build/serverExternals';

let root: string;
const nm = (...parts: string[]) => join(root, 'node_modules', ...parts);

const writePackage = async (
	dir: string,
	manifest: Record<string, unknown>,
	files: Record<string, string>
) => {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
	for (const [name, content] of Object.entries(files)) {
		await mkdir(join(dir, name, '..'), { recursive: true });
		await writeFile(join(dir, name), content);
	}
};

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'absolute-server-externals-'));
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'app', type: 'module' })
	);
	await mkdir(join(root, 'src'), { recursive: true });

	// Plain prebuilt JS package — the common case, externalizable.
	await writePackage(nm('plain'), { main: 'dist/index.js', name: 'plain' }, {
		'dist/index.js': 'export const plain = "plain";\n',
		'dist/package.json': '{"type":"module"}'
	});
	// Scoped package with `exports` — externalizable, subpath too.
	await writePackage(
		nm('@scope', 'pkg'),
		{
			exports: {
				'.': './index.mjs',
				'./sub': './sub/index.mjs'
			},
			name: '@scope/pkg'
		},
		{
			'index.mjs': 'export const scoped = 1;\n',
			'sub/index.mjs': 'export const sub = 2;\n'
		}
	);
	// Ships single-file components next to its JS — must stay bundled.
	await writePackage(nm('sfc-lib'), { main: 'index.js', name: 'sfc-lib' }, {
		'components/Widget.vue': '<template><div/></template>\n',
		'index.js': 'export const sfc = "sfc";\n'
	});
	// Multi-adapter package: the Vue subpath is prebuilt JS, the Svelte
	// subpath ships `.svelte` components next to its JS. Also declares a
	// peer dependency on svelte, which must NOT count as a Svelte entry.
	await writePackage(
		nm('multi-adapter'),
		{
			exports: {
				'./svelte': './dist/svelte/index.js',
				'./vue': './dist/vue/index.js'
			},
			name: 'multi-adapter',
			peerDependencies: { svelte: '^5', vue: '^3' }
		},
		{
			'dist/svelte/Router.svelte': '<div/>\n',
			'dist/svelte/index.js': 'export const svelteEntry = 1;\n',
			'dist/vue/index.js': 'export const vueEntry = 1;\n'
		}
	);
	// Declares a `svelte` export condition — bundler-only resolution.
	await writePackage(
		nm('svelte-cond-lib'),
		{
			exports: { '.': { default: './dist/index.js', svelte: './src/index.js' } },
			name: 'svelte-cond-lib'
		},
		{
			'dist/index.js': 'export const y = 1;\n',
			'src/index.js': 'export const y = 1;\n'
		}
	);
	// Unbuilt TypeScript entry — bundle it.
	await writePackage(nm('ts-src'), { main: 'index.ts', name: 'ts-src' }, {
		'index.ts': 'export const tsSrc: number = 1;\n'
	});
	// Nested duplicate: `host` depends on its own `dep` copy.
	await writePackage(nm('dep'), { main: 'index.js', name: 'dep', version: '2.0.0' }, {
		'index.js': 'export const dep = 2;\n'
	});
	await writePackage(nm('host'), { main: 'index.js', name: 'host' }, {
		'index.js': 'import { dep } from "dep"; export const host = dep;\n'
	});
	await writePackage(
		nm('host', 'node_modules', 'dep'),
		{ main: 'index.js', name: 'dep', version: '1.0.0' },
		{ 'index.js': 'export const dep = 1;\n' }
	);
	// Workspace package symlinked into node_modules from outside it.
	await writePackage(
		join(root, 'packages', 'local-lib'),
		{ main: 'index.js', name: 'local-lib' },
		{ 'index.js': 'export const local = 1;\n' }
	);
	await symlink(
		join(root, 'packages', 'local-lib'),
		nm('local-lib'),
		'dir'
	);
});

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

const importer = () => join(root, 'src', 'page.ts');

describe('packageNameOf', () => {
	test('extracts the package from bare and scoped specifiers', () => {
		expect(packageNameOf('three')).toBe('three');
		expect(packageNameOf('three/examples/jsm')).toBe('three');
		expect(packageNameOf('@scope/pkg')).toBe('@scope/pkg');
		expect(packageNameOf('@scope/pkg/sub')).toBe('@scope/pkg');
	});
});

describe('createDevServerExternalResolver', () => {
	test('externalizes resolvable prebuilt node_modules packages', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('plain', importer())).toBe(true);
		expect(resolver.isExternal('@scope/pkg', importer())).toBe(true);
		expect(resolver.isExternal('@scope/pkg/sub', importer())).toBe(true);
	});

	test('leaves relative, absolute, private and protocol specifiers to Bun', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('./local', importer())).toBe(false);
		expect(resolver.isExternal('../up', importer())).toBe(false);
		expect(resolver.isExternal('/abs/path.js', importer())).toBe(false);
		expect(resolver.isExternal('#internal', importer())).toBe(false);
		expect(resolver.isExternal('node:fs', importer())).toBe(false);
		expect(resolver.isExternal('bun:sqlite', importer())).toBe(false);
		expect(resolver.isExternal('fs', importer())).toBe(false);
		expect(resolver.isExternal('bun', importer())).toBe(false);
		expect(resolver.isExternal('', importer())).toBe(false);
	});

	test('does not externalize unresolvable packages', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('does-not-exist', importer())).toBe(false);
	});

	test('keeps packages shipping .vue / .svelte files next to the entry bundled', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('sfc-lib', importer())).toBe(false);
	});

	test('judges multi-adapter packages per resolved subpath', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('multi-adapter/vue', importer())).toBe(true);
		expect(resolver.isExternal('multi-adapter/svelte', importer())).toBe(
			false
		);
	});

	test('keeps packages with a svelte export condition bundled', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('svelte-cond-lib', importer())).toBe(false);
	});

	test('keeps unbuilt TypeScript entries bundled', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('ts-src', importer())).toBe(false);
	});

	test('keeps a nested duplicate bundled when the importer resolves elsewhere', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		// From app code `dep` is the hoisted 2.0.0 — external is fine.
		expect(resolver.isExternal('dep', importer())).toBe(true);
		// From inside `host`, `dep` is host's private 1.0.0 — the runtime
		// would load the wrong copy from the build dir, so bundle it.
		expect(resolver.isExternal('dep', nm('host', 'index.js'))).toBe(false);
	});

	test('keeps workspace symlinks (real path outside node_modules) bundled', () => {
		const resolver = createDevServerExternalResolver({ projectRoot: root });
		expect(resolver.isExternal('local-lib', importer())).toBe(false);
	});

	test('honours the bundleDependencies allowlist patterns', () => {
		const exact = createDevServerExternalResolver({
			bundleDependencies: ['plain'],
			projectRoot: root
		});
		expect(exact.isExternal('plain', importer())).toBe(false);
		expect(exact.isExternal('@scope/pkg', importer())).toBe(true);

		const bySpecifier = createDevServerExternalResolver({
			bundleDependencies: ['@scope/pkg/sub'],
			projectRoot: root
		});
		expect(bySpecifier.isExternal('@scope/pkg', importer())).toBe(true);
		expect(bySpecifier.isExternal('@scope/pkg/sub', importer())).toBe(false);

		const scopedGlob = createDevServerExternalResolver({
			bundleDependencies: ['@scope/*'],
			projectRoot: root
		});
		expect(scopedGlob.isExternal('@scope/pkg', importer())).toBe(false);
		expect(scopedGlob.isExternal('@scope/pkg/sub', importer())).toBe(false);
		expect(scopedGlob.isExternal('plain', importer())).toBe(true);

		const everything = createDevServerExternalResolver({
			bundleDependencies: ['*'],
			projectRoot: root
		});
		expect(everything.isExternal('plain', importer())).toBe(false);
		expect(everything.isExternal('@scope/pkg', importer())).toBe(false);
	});
});

describe('createDevServerExternalsPlugin', () => {
	test('Bun.build keeps external packages as bare imports and inlines the rest', async () => {
		const entry = join(root, 'src', 'entry.ts');
		await writeFile(
			entry,
			[
				'import { plain } from "plain";',
				'import { sub } from "@scope/pkg/sub";',
				'import { sfc } from "sfc-lib";',
				'import { tsSrc } from "ts-src";',
				'import { host } from "host";',
				'import { readFileSync } from "node:fs";',
				'export const all = [plain, sub, sfc, tsSrc, host, typeof readFileSync];',
				''
			].join('\n')
		);
		const outdir = join(root, 'out');
		const result = await Bun.build({
			entrypoints: [entry],
			format: 'esm',
			outdir,
			plugins: [createDevServerExternalsPlugin({ projectRoot: root })],
			target: 'bun',
			throw: false
		});
		expect(result.success).toBe(true);
		const output = await Bun.file(join(outdir, 'entry.js')).text();
		expect(output).toContain('from "plain"');
		expect(output).toContain('from "@scope/pkg/sub"');
		// `host` itself is external; its private `dep` copy is never seen.
		expect(output).toContain('from "host"');
		expect(output).not.toContain('from "sfc-lib"');
		expect(output).toContain('"sfc"');
		expect(output).not.toContain('from "ts-src"');
		expect(output).toContain('tsSrc = 1');
		// And the bundle actually runs: the runtime resolves the externals.
		const mod = (await import(join(outdir, 'entry.js'))) as {
			all: unknown[];
		};
		expect(mod.all).toEqual(['plain', 2, 'sfc', 1, 1, 'function']);
	});
});
