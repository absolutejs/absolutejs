import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDepVendorPaths } from '../../../src/build/buildDepVendor';

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { force: true, recursive: true });
	}
});

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
});
