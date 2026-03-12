import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadConfig } from '../../../src/utils/loadConfig';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

describe('loadConfig', () => {
	test('loads example config from path', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		expect(config.reactDirectory).toBeDefined();
		expect(config.svelteDirectory).toBeDefined();
		expect(config.vueDirectory).toBeDefined();
		expect(config.angularDirectory).toBeDefined();
		expect(config.htmlDirectory).toBeDefined();
		expect(config.htmxDirectory).toBeDefined();
	});

	test('config paths point to existing directories', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		const { existsSync } = await import('node:fs');
		if (config.reactDirectory)
			expect(existsSync(config.reactDirectory)).toBe(true);
		if (config.svelteDirectory)
			expect(existsSync(config.svelteDirectory)).toBe(true);
		if (config.vueDirectory)
			expect(existsSync(config.vueDirectory)).toBe(true);
		if (config.angularDirectory)
			expect(existsSync(config.angularDirectory)).toBe(true);
	});

	test('returns buildDirectory', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		expect(config.buildDirectory).toBeDefined();
	});
});
