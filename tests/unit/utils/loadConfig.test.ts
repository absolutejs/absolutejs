import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadConfig } from '../../../src/utils/loadConfig';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

describe('loadConfig', () => {
	test('loads example config from path', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		expect(config.reactConfig).toBeDefined();
		expect(config.svelteConfig).toBeDefined();
		expect(config.vueConfig).toBeDefined();
		expect(config.angularConfig).toBeDefined();
		expect(config.htmlConfig).toBeDefined();
		expect(config.htmxConfig).toBeDefined();
	});

	test('config paths point to existing directories', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		const { existsSync } = await import('node:fs');
		if (config.reactConfig)
			expect(
				existsSync(
					typeof config.reactConfig === 'string'
						? config.reactConfig
						: config.reactConfig.directory
				)
			).toBe(true);
		if (config.svelteConfig)
			expect(
				existsSync(
					typeof config.svelteConfig === 'string'
						? config.svelteConfig
						: config.svelteConfig.directory
				)
			).toBe(true);
		if (config.vueConfig)
			expect(
				existsSync(
					typeof config.vueConfig === 'string'
						? config.vueConfig
						: config.vueConfig.directory
				)
			).toBe(true);
		if (config.angularConfig)
			expect(
				existsSync(
					typeof config.angularConfig === 'string'
						? config.angularConfig
						: config.angularConfig.directory
				)
			).toBe(true);
	});

	test('returns buildDirectory', async () => {
		const config = await loadConfig(
			resolve(PROJECT_ROOT, 'example/absolute.config.ts')
		);
		expect(config.buildDirectory).toBeDefined();
	});
});
