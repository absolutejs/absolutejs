import { describe, expect, test, afterAll } from 'bun:test';
import { resolve } from 'node:path';
import { unlinkSync } from 'node:fs';
import { loadConfig } from '../../../src/utils/loadConfig';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const tempFiles: string[] = [];

afterAll(() => {
	for (const f of tempFiles) {
		try {
			unlinkSync(f);
		} catch {
			// already cleaned up
		}
	}
	delete process.env.ABSOLUTE_CONFIG;
});

describe('loadConfig edge cases', () => {
	test('loads config from explicit path', async () => {
		const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
		const config = await loadConfig(configPath);

		expect(config).toBeDefined();
		expect(config.reactDirectory).toBeDefined();
		expect(config.buildDirectory).toBeDefined();
	});

	test('loads config from ABSOLUTE_CONFIG env var', async () => {
		const configPath = resolve(PROJECT_ROOT, 'example/absolute.config.ts');
		process.env.ABSOLUTE_CONFIG = configPath;

		const config = await loadConfig();

		expect(config).toBeDefined();
		expect(config.reactDirectory).toBeDefined();

		delete process.env.ABSOLUTE_CONFIG;
	});

	test('throws for non-existent config file', async () => {
		const bogusPath = resolve(PROJECT_ROOT, 'does-not-exist.config.ts');

		expect(loadConfig(bogusPath)).rejects.toThrow();
	});

	test('throws for config file that exports nothing', async () => {
		const tempPath = resolve(PROJECT_ROOT, '__test-empty-config.ts');
		await Bun.write(tempPath, 'export default undefined;\n');
		tempFiles.push(tempPath);

		expect(loadConfig(tempPath)).rejects.toThrow(
			'does not export a valid configuration'
		);
	});
});
