import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeDepVendorPaths } from '../../../src/build/buildDepVendor';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

// Build a minimal fake package layout under <root>/node_modules/<name>/ for
// tests that need to exercise resolution + transitive scanning. Returns the
// package directory.
const makeFakePkg = (
	root: string,
	name: string,
	files: Record<string, string>,
	pkgJson: Record<string, unknown>
) => {
	const pkgDir = join(root, 'node_modules', name);
	mkdirSync(pkgDir, { recursive: true });
	writeFileSync(
		join(pkgDir, 'package.json'),
		JSON.stringify({ name, version: '0.0.0', ...pkgJson }, null, 2)
	);
	for (const [rel, src] of Object.entries(files)) {
		const fullPath = join(pkgDir, rel);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, src);
	}
	return pkgDir;
};

describe('computeDepVendorPaths', () => {
	test('does not vendor AbsoluteJS package entrypoints', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-dep-vendor-'));
		tempDirs.push(dir);
		writeFileSync(
			join(dir, 'entry.ts'),
			[
				`import { html } from '@absolutejs/absolute';`,
				`import { Island } from '@absolutejs/absolute/angular';`,
				`import { createStore } from 'zustand/vanilla';`,
				'void html;',
				'void Island;',
				'void createStore;'
			].join('\n')
		);

		const paths = await computeDepVendorPaths([dir]);

		expect(paths['@absolutejs/absolute']).toBeUndefined();
		expect(paths['@absolutejs/absolute/angular']).toBeUndefined();
		expect(paths['zustand/vanilla']).toBe('/vendor/zustand_vanilla.js');
	});

	// Regression: a published package whose "main" is a tiny CJS wrapper that
	// conditionally requires `./pkg.cjs.prod.js` or `./pkg.cjs.dev.js` (the
	// ubiquitous React-ecosystem pattern) used to defeat transitive discovery.
	// The wrapper itself contains only relative requires, so the old single-
	// file scan saw zero bare imports and the deep ones (here: `zustand-vendor`)
	// silently fell through to the browser as unresolved bare specifiers,
	// breaking hydration. Repro'd in the wild with @react-three/fiber missing
	// `zustand/traditional`. After the fix, collectBareImportsFromFile walks
	// past the wrapper and reaches the dev/prod files' bare imports.
	test('walks through CJS dev/prod wrappers to find deep bare imports', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-dep-vendor-'));
		tempDirs.push(dir);

		// The transitive-bare-import target. Just needs to exist so the
		// isResolvable() filter inside collectTransitiveImports accepts it.
		makeFakePkg(
			dir,
			'zustand-vendor',
			{ 'index.js': "module.exports = { createStore: () => {} };" },
			{ main: 'index.js' }
		);

		// The wrapper-style package: main → cjs wrapper → cjs.dev.js (which
		// holds the real `require('zustand-vendor')`).
		makeFakePkg(
			dir,
			'fake-r3f',
			{
				'dist/wrapper.cjs.js': [
					"'use strict';",
					"if (process.env.NODE_ENV === 'production') {",
					"  module.exports = require('./wrapper.cjs.prod.js');",
					"} else {",
					"  module.exports = require('./wrapper.cjs.dev.js');",
					"}"
				].join('\n'),
				'dist/wrapper.cjs.dev.js':
					"const z = require('zustand-vendor'); module.exports = { z };",
				'dist/wrapper.cjs.prod.js':
					"const z = require('zustand-vendor'); module.exports = { z };"
			},
			{ main: 'dist/wrapper.cjs.js' }
		);

		writeFileSync(
			join(dir, 'entry.ts'),
			[`import 'fake-r3f';`, "void 0;"].join('\n')
		);

		// The vendor pipeline resolves bare specifiers relative to
		// process.cwd(), so the fake package's node_modules has to live
		// somewhere cwd can reach it. cd in for the duration of the test
		// then restore — keeps the fixture self-contained.
		const originalCwd = process.cwd();
		process.chdir(dir);
		let paths: Record<string, string>;
		try {
			paths = await computeDepVendorPaths([dir]);
		} finally {
			process.chdir(originalCwd);
		}

		expect(paths['fake-r3f']).toBe('/vendor/fake_r3f.js');
		// The crux: the deep bare import becomes a vendor entry even though
		// the package's main file never names it.
		expect(paths['zustand-vendor']).toBe('/vendor/zustand_vendor.js');
	});

	test('@-scoped specs get an underscore prefix to avoid collision', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'absolute-dep-vendor-'));
		tempDirs.push(dir);
		// Without the underscore prefix on scoped names, `@elysiajs/static`
		// would map to `elysiajs_static.js` — same path Bun's resolver would
		// produce for an unscoped `elysiajs/static` if such a package
		// existed. The collision is observable for Firebase, where
		// `firebase/app` re-exports `@firebase/app` and both need their own
		// vendor file so the implementation can stay a singleton.
		writeFileSync(
			join(dir, 'entry.ts'),
			[
				`import { staticPlugin } from '@elysiajs/static';`,
				'void staticPlugin;'
			].join('\n')
		);

		const paths = await computeDepVendorPaths([dir]);

		expect(paths['@elysiajs/static']).toBe('/vendor/_elysiajs_static.js');
	});
});
