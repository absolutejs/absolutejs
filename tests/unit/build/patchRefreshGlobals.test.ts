import { describe, expect, test } from 'bun:test';
import { build as bunBuild } from 'bun';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { patchRefreshGlobals } from '../../../src/build/rewriteReactImports';

const STUB_PREFIX =
	'window.$RefreshReg$||(window.$RefreshReg$=function(){});' +
	'window.$RefreshSig$||(window.$RefreshSig$=function(){return function(t){return t}});\n';

const makeTemp = () => mkdtemp(join(tmpdir(), 'refresh-test-'));

/** Build a minimal React component with reactFastRefresh + splitting,
 *  simulating the real dev build. Returns paths of all output .js files. */
const buildReactWithRefresh = async (dir: string) => {
	const srcDir = join(dir, 'src');
	await mkdir(srcDir, { recursive: true });

	await writeFile(
		join(srcDir, 'Component.tsx'),
		`export const Greeting = () => <div>hello</div>;\n`
	);

	await writeFile(
		join(srcDir, 'entry.tsx'),
		`import { Greeting } from './Component';\nconsole.log(Greeting);\n`
	);

	// Second entry forces code splitting to extract shared code into chunks
	await writeFile(
		join(srcDir, 'entry2.tsx'),
		`import { Greeting } from './Component';\nexport { Greeting };\n`
	);

	const outdir = join(dir, 'out');
	const result = await bunBuild({
		entrypoints: [join(srcDir, 'entry.tsx'), join(srcDir, 'entry2.tsx')],
		external: ['react', 'react/jsx-dev-runtime', 'react/jsx-runtime'],
		format: 'esm',
		jsx: { development: true },
		naming: '[dir]/[name].[hash].[ext]',
		outdir,
		reactFastRefresh: true,
		root: srcDir,
		splitting: true,
		target: 'browser',
		throw: false
	});

	if (!result.success) {
		throw new Error(
			`Build failed: ${result.logs.map((l) => l.message).join(', ')}`
		);
	}

	return result.outputs.map((o) => o.path);
};

/** Check if a file has a bare $RefreshReg$ call without the stubs prepended */
const hasUnguardedRefresh = async (filePath: string) => {
	const content = await readFile(filePath, 'utf8');
	const hasCall =
		content.includes('$RefreshReg$(') ||
		content.includes('$RefreshSig$(');
	if (!hasCall) return false;

	return !content.startsWith('window.$RefreshReg$');
};

describe('patchRefreshGlobals', () => {
	test('prepends stubs to chunk with bare $RefreshReg$ call', async () => {
		const dir = await makeTemp();
		const file = join(dir, 'chunk-abc123.js');
		const original =
			'var Foo = function() {};\n$RefreshReg$(Foo, "Foo.tsx:Foo");\n';
		await writeFile(file, original);

		await patchRefreshGlobals([file]);

		const result = await readFile(file, 'utf8');
		expect(result).toBe(STUB_PREFIX + original);
		await rm(dir, { force: true, recursive: true });
	});

	test('prepends stubs to chunk with bare $RefreshSig$ call', async () => {
		const dir = await makeTemp();
		const file = join(dir, 'chunk-def456.js');
		const original = 'var _s = $RefreshSig$();\n';
		await writeFile(file, original);

		await patchRefreshGlobals([file]);

		const result = await readFile(file, 'utf8');
		expect(result).toBe(STUB_PREFIX + original);
		await rm(dir, { force: true, recursive: true });
	});

	test('skips files without $RefreshReg$ or $RefreshSig$', async () => {
		const dir = await makeTemp();
		const file = join(dir, 'chunk-norefresh.js');
		const original = 'var x = 1;\nexport { x };\n';
		await writeFile(file, original);

		await patchRefreshGlobals([file]);

		const result = await readFile(file, 'utf8');
		expect(result).toBe(original);
		await rm(dir, { force: true, recursive: true });
	});

	test('skips files already patched', async () => {
		const dir = await makeTemp();
		const file = join(dir, 'chunk-already.js');
		const original =
			`${STUB_PREFIX 
			}var Bar = function() {};\n$RefreshReg$(Bar, "Bar.tsx:Bar");\n`;
		await writeFile(file, original);

		await patchRefreshGlobals([file]);

		const result = await readFile(file, 'utf8');
		expect(result).toBe(original);
		await rm(dir, { force: true, recursive: true });
	});

	test('skips non-js files', async () => {
		const dir = await makeTemp();
		const file = join(dir, 'styles.css');
		const original = 'body { color: red; }\n';
		await writeFile(file, original);

		await patchRefreshGlobals([file]);

		const result = await readFile(file, 'utf8');
		expect(result).toBe(original);
		await rm(dir, { force: true, recursive: true });
	});

	test('patches multiple files in parallel', async () => {
		const dir = await makeTemp();
		const fileA = join(dir, 'chunk-a.js');
		const fileB = join(dir, 'chunk-b.js');
		const fileC = join(dir, 'chunk-c.js');
		const withRefresh = 'var A = 1;\n$RefreshReg$(A, "A.tsx:A");\n';
		const withoutRefresh = 'var B = 2;\nexport { B };\n';

		await writeFile(fileA, withRefresh);
		await writeFile(fileB, withoutRefresh);
		await writeFile(fileC, withRefresh);

		await patchRefreshGlobals([fileA, fileB, fileC]);

		expect(await readFile(fileA, 'utf8')).toBe(STUB_PREFIX + withRefresh);
		expect(await readFile(fileB, 'utf8')).toBe(withoutRefresh);
		expect(await readFile(fileC, 'utf8')).toBe(STUB_PREFIX + withRefresh);
		await rm(dir, { force: true, recursive: true });
	});
});

describe('reactFastRefresh build output', () => {
	test(
		'Bun.build with reactFastRefresh + splitting produces $RefreshReg$ calls that need patching',
		async () => {
			const dir = await makeTemp();
			const outputPaths = await buildReactWithRefresh(dir);

			// Verify the build actually produced $RefreshReg$ calls
			let filesWithRefresh = 0;
			for (const filePath of outputPaths) {
				const content = await readFile(filePath, 'utf8');
				if (content.includes('$RefreshReg$(')) filesWithRefresh++;
			}
			expect(filesWithRefresh).toBeGreaterThan(0);

			// Before patching: at least one file has unguarded $RefreshReg$
			let unguardedCount = 0;
			for (const filePath of outputPaths) {
				if (await hasUnguardedRefresh(filePath)) unguardedCount++;
			}
			expect(unguardedCount).toBeGreaterThan(0);

			// After patching: no file has unguarded $RefreshReg$
			await patchRefreshGlobals(outputPaths);

			for (const filePath of outputPaths) {
				const stillUnguarded = await hasUnguardedRefresh(filePath);
				if (stillUnguarded) {
					const content = await readFile(filePath, 'utf8');
					throw new Error(
						`${filePath} has unguarded $RefreshReg$ after patching. First 200 chars: ${content.slice(0, 200)}`
					);
				}
			}

			await rm(dir, { force: true, recursive: true });
		},
		15_000
	);
});
