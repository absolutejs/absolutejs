import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

// The standard esbuild/Bun CommonJS interop shim, exactly as dependencies
// ship it. Every `require` is behind a `typeof` guard, so evaluating this in
// a browser is safe — as long as nobody rewrites the guards away.
const REQUIRE_SHIM = [
	'var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {',
	'  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]',
	'}) : x)(function(x) {',
	'  if (typeof require !== "undefined")',
	'    return require.apply(this, arguments);',
	"  throw Error('Dynamic require of \"' + x + '\" is not supported');",
	'});',
	'',
	'export { __require };'
].join('\n');

const writeDependency = async (root: string, files: Record<string, string>) => {
	for (const [relativePath, contents] of Object.entries(files)) {
		const target = join(root, relativePath);
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, contents);
	}
};

describe('createModuleServer prebuilt dependency handling', () => {
	// Regression: Bun.Transpiler constant-folds `typeof require !== "undefined"`
	// to TRUE even with target:'browser' (Bun 1.3.14), so running a
	// dependency's prebuilt ESM through it turned the guarded interop shim
	// into a bare `((x) => require)(…)`. That threw "ReferenceError: require
	// is not defined" in the browser on module evaluation, while the same
	// input through Bun.build stayed correct — dev broke, production did not.
	test('serves a dependency prebuilt ESM without folding its require guards', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-prebuilt-'));
		try {
			await writeDependency(root, {
				'node_modules/fake-dep/dist/shim.js': REQUIRE_SHIM
			});

			const moduleServer = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			const response = await moduleServer(
				'/@src/node_modules/fake-dep/dist/shim.js'
			);
			expect(response?.status).toBe(200);
			const code = await response?.text();
			if (!code) throw new Error('Expected module server response body');

			// The guards must survive verbatim.
			expect(code).toContain('typeof require !== "undefined"');
			// …and the folded form must never appear.
			expect(code).not.toContain('((x) => require)');
			expect(code).not.toMatch(/if \(true\)/u);
			expect(code).toContain('export { __require }');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	// Minified dependency output butts the specifier straight against the
	// keyword (`import"./chunk.js";`), which the ESM sniff has to recognise.
	test('recognises minified ESM with no space after the keyword', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-prebuilt-'));
		try {
			await writeDependency(root, {
				'node_modules/fake-dep/dist/chunk.js': REQUIRE_SHIM,
				'node_modules/fake-dep/dist/min.js': [
					'import"./chunk.js";',
					'export const flag = typeof require !== "undefined";'
				].join('\n')
			});

			const moduleServer = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			const response = await moduleServer(
				'/@src/node_modules/fake-dep/dist/min.js'
			);
			const code = await response?.text();
			if (!code) throw new Error('Expected module server response body');

			expect(code).toContain('typeof require !== "undefined"');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('still rewrites bare specifiers inside prebuilt dependency ESM', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-prebuilt-'));
		try {
			await writeDependency(root, {
				'node_modules/fake-dep/dist/index.js': [
					"import { thing } from 'some-peer';",
					"export const value = typeof require !== 'undefined' ? thing : null;"
				].join('\n')
			});

			const moduleServer = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			const response = await moduleServer(
				'/@src/node_modules/fake-dep/dist/index.js'
			);
			const code = await response?.text();
			if (!code) throw new Error('Expected module server response body');

			// Bare specifiers still get resolved/stubbed for the browser…
			expect(code).not.toContain("from 'some-peer'");
			// …and the require guard is still untouched.
			expect(code).toContain("typeof require !== 'undefined'");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	// The carve-out is scoped to node_modules: application code still needs
	// the transpiler (TypeScript, JSX, HMR injection all depend on it).
	test('still transpiles application TypeScript outside node_modules', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-prebuilt-'));
		try {
			await writeDependency(root, {
				'app.ts': 'export const greet = (name: string): string => name;'
			});

			const moduleServer = createModuleServer({
				projectRoot: root,
				vendorPaths: {}
			});
			const response = await moduleServer('/@src/app.ts');
			const code = await response?.text();
			if (!code) throw new Error('Expected module server response body');

			expect(code).not.toContain(': string');
			expect(code).toContain('greet');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
