import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	VENDORED_HTMX_VERSION,
	detectHtmxVersion,
	readVendoredHtmx
} from '../../../src/cli/htmx/install';

const repoRoot = resolve(import.meta.dir, '..', '..', '..');

describe('vendored htmx', () => {
	test('the vendored file is the version `absolute htmx` reports', () => {
		const content = readVendoredHtmx();
		expect(content).not.toBeNull();
		expect(detectHtmxVersion(content ?? '')).toBe(VENDORED_HTMX_VERSION);
	});

	test('the example app ships the same htmx build', () => {
		const exampleDir = join(repoRoot, 'example', 'htmx');
		const files = readdirSync(exampleDir).filter((name) =>
			/^htmx.*\.min\.js$/.test(name)
		);
		expect(files).toEqual([`htmx.${VENDORED_HTMX_VERSION}.min.js`]);
		const example = readFileSync(join(exampleDir, files[0] ?? ''), 'utf-8');
		expect(example).toBe(readVendoredHtmx() ?? '');
	});
});
