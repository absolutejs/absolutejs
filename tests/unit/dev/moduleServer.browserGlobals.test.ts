import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createModuleServer } from '../../../src/dev/moduleServer';

// The standard esbuild/Bun CommonJS interop shim, exactly as dependencies
// ship it. Every `require` is behind a `typeof` guard so it is browser-safe —
// as long as nobody folds the guard the wrong way.
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

const writeFiles = async (root: string, files: Record<string, string>) => {
	for (const [relativePath, contents] of Object.entries(files)) {
		const target = join(root, relativePath);
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, contents);
	}
};

const serve = async (files: Record<string, string>, pathname: string) => {
	const root = await mkdtemp(join(tmpdir(), 'absolutejs-browser-globals-'));
	try {
		await writeFiles(root, files);
		const moduleServer = createModuleServer({
			projectRoot: root,
			vendorPaths: {}
		});
		const response = await moduleServer(pathname);
		const code = await response?.text();
		if (!code) throw new Error('Expected module server response body');

		return code;
	} finally {
		await rm(root, { force: true, recursive: true });
	}
};

describe('createModuleServer browser globals', () => {
	// Regression: Bun folds `typeof require !== "undefined"` to TRUE whatever
	// `target` says (oven-sh/bun#38202), turning the guarded interop shim into a
	// bare `((x) => require)(…)`. That threw "ReferenceError: require is not
	// defined" in the browser on module evaluation, while the same input through
	// Bun.build stayed correct — so dev broke and production did not.
	test('folds a require guard to the browser branch, never to a bare require', async () => {
		const code = await serve(
			{ 'node_modules/fake-dep/dist/shim.js': REQUIRE_SHIM },
			'/@src/node_modules/fake-dep/dist/shim.js'
		);

		// The browser branch survives…
		expect(code).toContain('typeof Proxy !== "undefined"');
		expect(code).toContain('export { __require }');
		// …and no bare `require` reference is left to throw on evaluation.
		expect(code).not.toContain('((x) => require)');
		expect(code).not.toMatch(/if \(true\)/u);
		expect(code).not.toMatch(/[^.\w]require\.apply/u);
	});

	test('resolves a free require check to false in application code', async () => {
		const code = await serve(
			{
				'app.ts':
					'export const hasRequire = typeof require !== "undefined";'
			},
			'/@src/app.ts'
		);

		expect(code).toContain('false');
		expect(code).not.toMatch(/typeof require/u);
	});

	// `define` substitutes free identifiers only — a dependency that builds its
	// own `require` must keep working.
	test('leaves local, parameter and property `require` bindings alone', async () => {
		const code = await serve(
			{
				'node_modules/fake-dep/dist/scoped.js': [
					'import { createRequire } from "node:module";',
					'export const local = () => {',
					'  const require = createRequire(import.meta.url);',
					'  return require("./thing.json");',
					'};',
					'export const param = (require) => require("x");',
					'export const prop = { require: 1 }.require;'
				].join('\n')
			},
			'/@src/node_modules/fake-dep/dist/scoped.js'
		);

		expect(code).toContain('const require = createRequire(');
		expect(code).toContain('(require) => require("x")');
		expect(code).toContain('.require');
	});

	// The transpiler also inlines `process.env.NODE_ENV` for the browser; that
	// substitution has to survive alongside the require define, or dependencies
	// that branch on NODE_ENV throw "process is not defined" instead.
	test('still inlines process.env.NODE_ENV for the browser', async () => {
		const code = await serve(
			{
				'node_modules/fake-dep/dist/env.js':
					'export const dev = process.env.NODE_ENV !== "production";'
			},
			'/@src/node_modules/fake-dep/dist/env.js'
		);

		expect(code).not.toContain('process.env');
	});

	test('still transpiles application TypeScript', async () => {
		const code = await serve(
			{
				'typed.ts':
					'export const greet = (name: string): string => name;'
			},
			'/@src/typed.ts'
		);

		expect(code).not.toContain(': string');
		expect(code).toContain('greet');
	});
});
