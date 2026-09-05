import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
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
const FIXTURE = resolve(
	import.meta.dir,
	'../../fixtures/vendor-nested-dep'
);

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
