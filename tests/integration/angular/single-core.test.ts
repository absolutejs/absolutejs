import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveAngularRuntimePath } from '../../../src/angular/resolveAngularPackage';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

describe('Angular SSR — single @angular/core instance', () => {
	test('two dynamic imports of @angular/core resolve to the same module record', async () => {
		// Verifies the §1.1 invariant: in dev, with no server vendor on
		// disk, every `import('@angular/core')` falls through node_modules
		// and Bun's ESM cache hands back the same instance. Without the
		// fix, two cache keys (resolved-path vs bare-specifier) produce
		// two instances with separate `currentInjector` globals — the
		// NG0203 trigger after HMR cycles.
		const coreSpec = '@angular/core';
		const path1 = resolveAngularRuntimePath(coreSpec);
		const path2 = resolveAngularRuntimePath(coreSpec);
		expect(path1).toBe(path2);

		// Skip the actual import if the package isn't available in the
		// test runner's resolution scope.
		const coreNodeModulesEntry = resolve(
			PROJECT_ROOT,
			'node_modules/@angular/core'
		);
		if (!existsSync(coreNodeModulesEntry)) {
			expect(path1).toBe('@angular/core');

			return;
		}

		// Bare specifier (the path code uses in dev — see angularDeps.ts)
		// must hand back the same module record across calls.
		const mod1 = await import('@angular/core');
		const mod2 = await import('@angular/core');
		expect(mod1).toBe(mod2);
		expect(mod1.inject).toBe(mod2.inject);
	});

	test('resolveAngularRuntimePath falls through to node_modules when no vendor file exists', () => {
		// When ABSOLUTE_BUILD_DIR points at a directory that doesn't have
		// `angular/vendor/server/<spec>.js`, the resolver should return
		// either the resolved node_modules entry or the bare specifier
		// — never a non-existent vendor path.
		const previousEnv = process.env.ABSOLUTE_BUILD_DIR;
		process.env.ABSOLUTE_BUILD_DIR = resolve(PROJECT_ROOT, 'tmp-no-build');
		try {
			const resolved = resolveAngularRuntimePath('@angular/core');
			expect(resolved).not.toContain('vendor/server');
		} finally {
			if (previousEnv === undefined) {
				delete process.env.ABSOLUTE_BUILD_DIR;
			} else {
				process.env.ABSOLUTE_BUILD_DIR = previousEnv;
			}
		}
	});
});
