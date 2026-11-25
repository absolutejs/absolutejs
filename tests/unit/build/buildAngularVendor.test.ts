import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeAngularVendorPathsAsync } from '../../../src/build/buildAngularVendor';

const tempRoots = new Set<string>();

const makeTempDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), 'absolute-angular-vendor-'));
	tempRoots.add(dir);

	return dir;
};

afterEach(async () => {
	for (const root of [...tempRoots]) {
		await rm(root, { force: true, recursive: true }).catch(() => {});
		tempRoots.delete(root);
	}
});

describe('buildAngularVendor', () => {
	test('does not vendor Angular build-time packages into the browser vendor', async () => {
		const root = await makeTempDir();
		await mkdir(join(root, 'angular'), { recursive: true });
		await writeFile(
			join(root, 'angular', 'page.ts'),
			`import type { CompilerOptions } from '@angular/compiler-cli';
import { Component } from '@angular/core';

export const options: CompilerOptions | null = null;
export const component = Component;
`
		);

		const paths = await computeAngularVendorPathsAsync(
			[join(root, 'angular')],
			false
		);

		expect(paths['@angular/core']).toBe('/angular/vendor/angular_core.js');
		expect(paths['@angular/compiler-cli']).toBeUndefined();
		expect(paths['@angular/compiler-cli/linker']).toBeUndefined();
	});

	/* Pinned before the two scanning functions were restructured to pass
	 * the lint, and compared against the old version's output on this
	 * fixture and on the example app: identical, order included. The
	 * order matters — it is the order vendor bundles are built in. */
	const fixture = async () => {
		const root = await makeTempDir();
		const write = async (path: string, contents: string) => {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), contents);
		};
		await write(
			'angular/pages/home.ts',
			`import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { local } from './local';
import { renderApplication } from '@angular/platform-server';
import '@src/alias';
export const used = [Component, HttpClient, toSignal, map, local, renderApplication];
`
		);
		await write(
			'angular/build/skipped.ts',
			"import { FormsModule } from '@angular/forms';\nexport const forms = FormsModule;\n"
		);
		await write(
			'other/widget.tsx',
			"import { Title } from '@angular/platform-browser';\nimport { animate } from '@angular/animations';\nexport const used = [Title, animate];\n"
		);
		await write('other/broken.ts', 'this is not ) valid { typescript');

		return [join(root, 'angular'), join(root, 'other'), join(root, 'gone')];
	};

	test('finds Angular imports in source order, directory by directory', async () => {
		const found = Object.keys(
			await computeAngularVendorPathsAsync(await fixture(), false)
		);

		expect(found.slice(0, 5)).toEqual([
			'@angular/core',
			'@angular/common/http',
			'@angular/core/rxjs-interop',
			'@angular/platform-browser',
			'@angular/animations'
		]);
	});

	test('skips build output, server-only packages, and files it cannot parse', async () => {
		const found = Object.keys(
			await computeAngularVendorPathsAsync(await fixture(), false)
		);

		expect(found).not.toContain('@angular/forms');
		expect(found).not.toContain('@angular/platform-server');
		expect(found).not.toContain('rxjs');
	});

	/* Reached only through another package's own imports. */
	test('follows dependencies to the Angular subpaths they import', async () => {
		const found = Object.keys(
			await computeAngularVendorPathsAsync(await fixture(), false)
		);

		expect(found).toContain('@angular/core/primitives/signals');
	});

	test('adds the compiler when components are compiled at run time', async () => {
		const dirs = await fixture();
		const aot = Object.keys(
			await computeAngularVendorPathsAsync(dirs, false)
		);
		const jit = Object.keys(
			await computeAngularVendorPathsAsync(dirs, true)
		);

		expect(aot).not.toContain('@angular/compiler');
		expect(jit).toContain('@angular/compiler');
	});
});
