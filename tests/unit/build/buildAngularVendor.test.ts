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
});
