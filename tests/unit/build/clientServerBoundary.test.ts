import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import {
	createClientProcessEnvPlugin,
	createServerOnlyPlugin,
	findClientProcessEnv,
	resolveClientProcessEnvMode,
	serverOnlyMessage
} from '../../../src/build/clientServerBoundary';

/* The server/client boundary (item 0.7). Two things a browser used to find
 * before the build did: a server module pulled into a client bundle, and a
 * `process.env.X` read that survives into the bundle and throws
 * `ReferenceError: process is not defined` when the module evaluates. */

const scan = (source: string, define: Record<string, string> = {}) =>
	findClientProcessEnv({ define, fileName: '/app/src/Clock.ts', source });

const keys = (source: string, define?: Record<string, string>) =>
	scan(source, define).map((reference) => reference.key);

describe('finding process.env in client code', () => {
	test('reports a bare read, with the place to go and fix it', () => {
		expect(
			scan('const a = 1;\nexport const url = process.env.API_URL;')
		).toEqual([{ column: 20, key: 'process.env.API_URL', line: 2 }]);
	});

	test('reads an indexed key as the key', () => {
		expect(keys("export const s = process.env['SECRET'];")).toEqual([
			'process.env.SECRET'
		]);
	});

	test('a computed key or the whole object has no single key', () => {
		expect(
			keys('export const read = (name) => process.env[name];')
		).toEqual(['process.env']);
		expect(keys('export const all = { ...process.env };')).toEqual([
			'process.env'
		]);
	});

	test('counts each reference once, however it is indexed', () => {
		expect(keys('f(process.env.A, process.env.B);')).toEqual([
			'process.env.A',
			'process.env.B'
		]);
	});

	test('NODE_ENV is exempt: Bun substitutes it in every browser bundle', () => {
		// resolveBuildMode.ts — and verified against Bun itself: the dev
		// client passes define nothing and Bun still compiles it to
		// "development". So it neither crashes nor leaks.
		expect(keys('if (process.env.NODE_ENV === "production") f();')).toEqual(
			[]
		);
	});

	test("a key the pass's define substitutes is exempt", () => {
		expect(
			keys('export const v = process.env.VERSION;', {
				'process.env.VERSION': '"1.0.0"'
			})
		).toEqual([]);
	});
});

describe('a typeof process test is the documented way to keep a read', () => {
	test('guards with &&, a ternary, and an if/else', () => {
		expect(
			keys(
				"export const a = typeof process !== 'undefined' && process.env.A;"
			)
		).toEqual([]);
		expect(
			keys(
				"export const b = typeof process === 'undefined' ? '' : process.env.B;"
			)
		).toEqual([]);
		expect(
			keys(
				"let c; if (typeof process !== 'undefined') { c = process.env.C; } else { c = ''; }"
			)
		).toEqual([]);
		expect(
			keys(
				"let d; if (typeof process === 'undefined') { d = ''; } else { d = process.env.D; }"
			)
		).toEqual([]);
	});

	test('and an early return that leaves before the read', () => {
		/* The shape the fix to `serverSecrets.ts` was written in, and the
		 * reason this is recognised at all: the read is not inside the
		 * `if`, so the ancestor walk alone cannot see it, and a check that
		 * makes the most natural guard look like a defect is a check people
		 * turn off. */
		expect(
			keys(
				"export const read = () => {\n\tif (typeof process === 'undefined') return '';\n\n\treturn process.env.LATE;\n};"
			)
		).toEqual([]);
		expect(
			keys(
				"export const read = () => {\n\tif (typeof process === 'undefined') throw new Error('server only');\n\n\treturn process.env.LATE;\n};"
			)
		).toEqual([]);
	});

	test('but not one that does not leave, or comes after the read', () => {
		// An `if` whose branch falls through guards nothing…
		expect(
			keys(
				"export const read = () => {\n\tif (typeof process === 'undefined') log('no env');\n\n\treturn process.env.LATE;\n};"
			)
		).toEqual(['process.env.LATE']);
		// …and neither does a test the read has already run past.
		expect(
			keys(
				"export const read = () => {\n\tconst value = process.env.EARLY;\n\tif (typeof process === 'undefined') return '';\n\n\treturn value;\n};"
			)
		).toEqual(['process.env.EARLY']);
	});

	test('typeof window and typeof document ask the same question', () => {
		expect(
			keys(
				"export const base = typeof window !== 'undefined' ? window.location.origin : (process.env.SITE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`);"
			)
		).toEqual([]);
		expect(
			keys(
				"export const read = () => {\n\tif (typeof document !== 'undefined') return '';\n\n\treturn process.env.LATE;\n};"
			)
		).toEqual([]);
		// A test of some other global guards nothing.
		expect(
			keys(
				"export const x = typeof navigator !== 'undefined' ? '' : process.env.X;"
			)
		).toEqual(['process.env.X']);
	});

	test('a bare typeof process elsewhere in the file guards nothing', () => {
		expect(
			keys(
				"export const onServer = typeof process !== 'undefined';\nexport const url = process.env.API_URL;"
			)
		).toEqual(['process.env.API_URL']);
	});
});

describe('what is not a reference', () => {
	test('a string, a comment or a template literal', () => {
		// The repo has already shipped one bug from a text scan that could
		// not tell these apart (maskLiterals.ts), so this one parses.
		expect(
			keys(
				[
					'// read process.env.A on the server',
					'/* process.env.B */',
					'export const hint = "use process.env.C in the handler";',
					'export const tip = `process.env.D`;'
				].join('\n')
			)
		).toEqual([]);
	});

	test('a property named env on something else', () => {
		expect(keys('export const v = config.env.API_URL;')).toEqual([]);
		expect(keys('export const w = import.meta.env.API_URL;')).toEqual([]);
	});

	test('a file that never mentions it is not even parsed', () => {
		// The substring pre-check is what keeps the parser off nearly every
		// module in a build.
		expect(keys('export const sum = (a, b) => a + b;')).toEqual([]);
	});

	test('TSX parses', () => {
		expect(
			findClientProcessEnv({
				fileName: '/app/src/Clock.tsx',
				source: 'export const C = () => <p>{process.env.API_URL}</p>;'
			}).map((reference) => reference.key)
		).toEqual(['process.env.API_URL']);
	});
});

describe('the default mode', () => {
	test('errors for a build and warns under the dev server', () => {
		/* Dev warns because failing one bundling pass takes down every page
		 * in it, which is worse than the runtime error being pre-empted. The
		 * argument is `options.injectHMR`, not the resolved development
		 * mode: `absolute build` never sets it, so a builder module first
		 * imported under NODE_ENV=development cannot soften a production
		 * build's check. */
		expect(resolveClientProcessEnvMode(undefined, false)).toBe('error');
		expect(resolveClientProcessEnvMode(undefined, true)).toBe('warn');
	});

	test('an explicit setting wins in both', () => {
		expect(resolveClientProcessEnvMode('warn', false)).toBe('warn');
		expect(resolveClientProcessEnvMode('error', true)).toBe('error');
	});
});

describe('the marker module itself', () => {
	test('is inert on a server and throws where there is a document', async () => {
		/* The backstop for the paths the bundler is not on — chiefly the dev
		 * module server, which serves unbundled ESM per file, so a module
		 * reached only at runtime never passes through a client pass.
		 *
		 * Evaluated from source rather than imported, with `globalThis`
		 * shadowed. Importing it would make this test depend on test order:
		 * any file in the same process that installs a happy-dom
		 * `document` first makes the import itself throw — which is the
		 * module working, not failing. */
		const source = await Bun.file(
			new URL('../../../src/serverOnly.ts', import.meta.url)
		).text();
		const evaluate = new Function(
			'globalThis',
			source.replace('export const SERVER_ONLY = true;', '')
		);

		expect(() => evaluate({})).not.toThrow();
		expect(() => evaluate({ document: {} })).toThrow(
			/evaluated in a browser/
		);
		expect(() => evaluate({ window: {} })).toThrow(
			/evaluated in a browser/
		);
	});
});

/* The plugins, through a real browser-target Bun.build: a plugin that
 * throws has to become a failed pass with a usable message, because that
 * is what src/core/build.ts turns into a build failure. */
describe('a browser pass carrying the boundary plugins', () => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-boundary-'));
	mkdirSync(join(root, 'src'), { recursive: true });
	const write = (name: string, source: string) => {
		const path = join(root, 'src', name);
		writeFileSync(path, source);

		return path;
	};
	const bundle = async (
		entry: string,
		plugins: Parameters<typeof Bun.build>[0]['plugins']
	) =>
		Bun.build({
			entrypoints: [entry],
			outdir: join(root, 'out'),
			plugins,
			target: 'browser',
			throw: false
		});

	afterAll(() => {
		rmSync(root, { force: true, recursive: true });
	});

	test('fails on the server-only marker, naming the importer', async () => {
		write(
			'db.ts',
			"import '@absolutejs/absolute/server-only';\nexport const q = () => 1;"
		);
		const entry = write(
			'page.ts',
			"import { q } from './db';\nconsole.log(q());"
		);
		const result = await bundle(entry, [createServerOnlyPlugin(root)]);

		expect(result.success).toBe(false);
		const [log] = result.logs;
		// The importer, not the page: that is the file holding the import to
		// cut, and the message says to follow the chain back from the page.
		expect(log?.message).toContain('src/db.ts');
		expect(log?.message).toContain('server-only');
	});

	test("the bare 'server-only' specifier gets the same message", async () => {
		const entry = write(
			'next.ts',
			"import 'server-only';\nexport const x = 1;"
		);
		const result = await bundle(entry, [createServerOnlyPlugin(root)]);

		expect(result.success).toBe(false);
		expect(result.logs[0]?.message).toContain(
			'must not be part of a browser bundle'
		);
	});

	test("a dependency's import is named as that package's bug", async () => {
		/* A package that drags the marker into a browser bundle is not
		 * something to go and refactor in the project's own code, so the
		 * advice to follow the imports from the page would send someone
		 * looking for a file they do not have. */
		const message = serverOnlyMessage(
			join(root, 'node_modules', '@vendor', 'orm', 'index.js'),
			root
		);

		expect(message).toContain('@vendor/orm');
		expect(message).toContain('report it upstream');
		expect(message).not.toContain("your page's client entry");
	});

	test('a server-only import is fine when no client pass sees it', async () => {
		// The plugin goes on the browser passes only; the same module is
		// ordinary code for the server bundle.
		const entry = write(
			'serverEntry.ts',
			"import './db';\nexport const y = 2;"
		);
		const result = await Bun.build({
			entrypoints: [entry],
			external: ['@absolutejs/absolute/server-only'],
			outdir: join(root, 'out-server'),
			target: 'bun',
			throw: false
		});

		expect(result.success).toBe(true);
	});

	const processEnvPlugin = (mode: 'error' | 'warn') =>
		createClientProcessEnvPlugin({
			generatedRoot: join(root, '.absolutejs', 'generated'),
			mode,
			projectRoot: root
		});

	test('fails the pass on process.env when the mode is error', async () => {
		const entry = write(
			'leaky.ts',
			'export const url = process.env.API_URL;'
		);
		const result = await bundle(entry, [processEnvPlugin('error')]);

		expect(result.success).toBe(false);
		expect(result.logs[0]?.message).toContain('src/leaky.ts');
		expect(result.logs[0]?.message).toContain('process.env.API_URL');
		expect(result.logs[0]?.message).toContain(
			'ReferenceError: process is not defined'
		);
	});

	test('still bundles when the mode is warn', async () => {
		const entry = write(
			'warned.ts',
			'export const url = process.env.API_URL;'
		);
		const result = await bundle(entry, [processEnvPlugin('warn')]);

		expect(result.success).toBe(true);
	});

	test("a dependency's own process.env is not the project author's to fix", async () => {
		/* Its own temp root, created complete before anything is bundled
		 * from it: Bun caches a directory's entries, so a `node_modules`
		 * added after an earlier pass walked that directory does not
		 * resolve. */
		const depRoot = mkdtempSync(join(tmpdir(), 'absolute-boundary-dep-'));
		const packageDir = join(depRoot, 'node_modules', 'leaky-dep');
		mkdirSync(packageDir, { recursive: true });
		mkdirSync(join(depRoot, 'src'), { recursive: true });
		writeFileSync(
			join(packageDir, 'package.json'),
			JSON.stringify({
				main: 'index.js',
				name: 'leaky-dep',
				version: '1.0.0'
			})
		);
		writeFileSync(
			join(packageDir, 'index.js'),
			'export const region = process.env.AWS_REGION;'
		);
		const entry = join(depRoot, 'src', 'usesDep.ts');
		writeFileSync(entry, "export { region } from 'leaky-dep';");
		const result = await Bun.build({
			entrypoints: [entry],
			outdir: join(depRoot, 'out'),
			plugins: [
				createClientProcessEnvPlugin({
					generatedRoot: join(depRoot, '.absolutejs', 'generated'),
					mode: 'error',
					projectRoot: depRoot
				})
			],
			target: 'browser',
			throw: false
		});
		rmSync(depRoot, { force: true, recursive: true });

		expect(result.logs).toEqual([]);
		expect(result.success).toBe(true);
	});
});
