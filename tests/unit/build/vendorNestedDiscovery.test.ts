import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join, dirname } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { collectTransitiveImports } from '../../../src/build/buildDepVendor';

/* A dependency that is not hoisted can only be resolved from the package that
 * imports it. Discovery used to resolve every specifier from the project root,
 * so it stopped at the first such package and never saw what that package
 * itself needed — the specifier then survived into the built vendor bundle
 * bare, where nothing rewrites it and the browser cannot load it.
 *
 * The fixture mirrors the real shape that surfaced this:
 *   wrapper (hoisted) → nested (NOT hoisted) → hoisted/deep/subpath.js
 * which was @react-three/postprocessing → n8ao → three/examples/jsm/... */
let FIXTURE: string;
beforeAll(async () => {
	FIXTURE = await mkdtemp(join(tmpdir(), 'absolute-vendor-nested-'));
	const files = {
		'node_modules/wrapper/package.json': JSON.stringify({
			name: 'wrapper',
			type: 'module',
			main: 'index.js'
		}),
		'node_modules/wrapper/index.js':
			"import 'nested'; export const wrapper = 1;",
		'node_modules/wrapper/node_modules/nested/package.json': JSON.stringify(
			{ name: 'nested', type: 'module', main: 'index.js' }
		),
		'node_modules/wrapper/node_modules/nested/index.js':
			"import 'hoisted/deep/subpath.js'; export const nested = 1;",
		'node_modules/hoisted/package.json': JSON.stringify({
			name: 'hoisted',
			type: 'module',
			main: 'index.js'
		}),
		'node_modules/hoisted/index.js': 'export const hoisted = 1;',
		'node_modules/hoisted/deep/subpath.js': 'export const deep = 1;'
	};
	for (const [path, content] of Object.entries(files)) {
		const file = join(FIXTURE, path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
	}
});
afterAll(async () => {
	await rm(FIXTURE, { recursive: true, force: true });
});

const inFixture = async <T>(body: () => Promise<T>) => {
	const cwd = process.cwd();
	process.chdir(FIXTURE);
	try {
		return await body();
	} finally {
		process.chdir(cwd);
	}
};

describe('vendor discovery through a non-hoisted dependency', () => {
	test('finds a specifier only a nested package imports', async () => {
		const found = await inFixture(() =>
			collectTransitiveImports(['wrapper'], new Set(), new Set())
		);

		expect([...found]).toContain('hoisted/deep/subpath.js');
	});

	test('does not offer the nested package itself as a vendor entry', async () => {
		// `nested` is walked through, but the project root cannot resolve it,
		// so it cannot become a /vendor/<name>.js entry. Traversal and
		// vendorability are separate questions.
		const found = await inFixture(() =>
			collectTransitiveImports(['wrapper'], new Set(), new Set())
		);

		expect([...found]).not.toContain('nested');
	});

	test('skips what is already vendored', async () => {
		const found = await inFixture(() =>
			collectTransitiveImports(
				['wrapper'],
				new Set(['hoisted/deep/subpath.js']),
				new Set()
			)
		);

		expect([...found]).not.toContain('hoisted/deep/subpath.js');
	});
});
