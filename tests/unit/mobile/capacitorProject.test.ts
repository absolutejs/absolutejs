import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAbsoluteCapacitorConfig } from '../../../src/mobile/capacitorProject';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('Capacitor project config', () => {
	test('owns webDir and custom native source paths without a remote server URL', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-capacitor-project-')
		);
		temporaryDirectories.push(root);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				nativeProject: { directory: 'mobile' },
				server: { productionOrigin: 'https://api.example.com' }
			},
			root
		);

		const first = await writeAbsoluteCapacitorConfig(config, {
			projectRoot: root
		});
		const second = await writeAbsoluteCapacitorConfig(config, {
			projectRoot: root
		});
		const source = await readFile(first.path, 'utf8');

		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
		expect(source).toContain('webDir: ".absolutejs/mobile/web"');
		expect(source).toContain('path: "mobile/android"');
		expect(source).toContain('path: "mobile/ios"');
		expect(source).not.toContain('server:');
	});
});
