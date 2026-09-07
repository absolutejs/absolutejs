import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	createAbsoluteMobileUpdateServerPlugin,
	loadAbsoluteMobileUpdateServerModule,
	renderAbsoluteMobileUpdateRegistry,
	writeAbsoluteMobileUpdateRegistry
} from '../../../src/mobile/updateServer';

const roots: string[] = [];
const temporaryRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-update-server-'));
	roots.push(root);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const publicKeys = () => {
	const { publicKey } = generateKeyPairSync('ec', {
		namedCurve: 'prime256v1'
	});

	return {
		main: publicKey
			.export({ format: 'der', type: 'spki' })
			.toString('base64')
	};
};

const registryModule = (storage: 'durable' | 'local') => `
export const absoluteMobileUpdateServer = { format: 1, provider: 'test', storage: '${storage}' };
export default {
	publishUpdate: async () => ({}),
	promoteUpdate: async () => ({}),
	rollbackUpdate: async () => ({}),
	resolveUpdate: async () => null,
	readUpdateFile: async () => null
};
`;

describe('trusted mobile update server', () => {
	test('generates explicit local and durable adapter modules without secrets', () => {
		const local = renderAbsoluteMobileUpdateRegistry({
			publicKeys: { main: 'public-only' },
			storage: 'local'
		});
		const durable = renderAbsoluteMobileUpdateRegistry({
			publicKeys: { main: 'public-only' },
			storage: 's3'
		});

		expect(local).toContain("storage: 'local'");
		expect(local).toContain('@absolutejs/blob/local');
		expect(durable).toContain("storage: 'durable'");
		expect(durable).toContain('ABSOLUTE_MOBILE_UPDATE_S3_BUCKET');
		expect(local).not.toContain('PRIVATE_KEY');
		expect(durable).not.toContain('PRIVATE_KEY');
	});

	test('writes safely and refuses accidental replacement', async () => {
		const projectRoot = await temporaryRoot();
		const path = await writeAbsoluteMobileUpdateRegistry({
			projectRoot,
			publicKeys: { main: 'public-only' },
			storage: 'local'
		});
		expect(await readFile(path, 'utf8')).toContain(
			'.absolutejs/mobile/update-registry'
		);
		await expect(
			writeAbsoluteMobileUpdateRegistry({
				projectRoot,
				publicKeys: { main: 'public-only' },
				storage: 's3'
			})
		).rejects.toThrow('--force');
	});

	test('loads marked registries and rejects unmarked server code', async () => {
		const projectRoot = await temporaryRoot();
		await writeFile(
			join(projectRoot, 'mobile.update.ts'),
			registryModule('local')
		);
		expect(
			(await loadAbsoluteMobileUpdateServerModule(projectRoot)).metadata
		).toMatchObject({ provider: 'test', storage: 'local' });
		await writeFile(
			join(projectRoot, 'unmarked.ts'),
			registryModule('local').replace(
				'export const absoluteMobileUpdateServer',
				'const ignored'
			)
		);
		await expect(
			loadAbsoluteMobileUpdateServerModule(projectRoot, 'unmarked.ts')
		).rejects.toThrow('absoluteMobileUpdateServer');
		await expect(
			loadAbsoluteMobileUpdateServerModule(projectRoot, '../outside.ts')
		).rejects.toThrow('inside the project');
	});

	test('auto-mounts in development and blocks local storage in production', async () => {
		const projectRoot = await temporaryRoot();
		await writeFile(
			join(projectRoot, 'mobile.update.ts'),
			registryModule('local')
		);
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				platforms: ['android'],
				server: { productionOrigin: 'https://api.example.com' },
				updates: { publicKeys: publicKeys() }
			},
			projectRoot
		);
		const plugin = await createAbsoluteMobileUpdateServerPlugin(
			config,
			projectRoot
		);
		const response = await plugin.handle(
			new Request(
				'https://api.example.com/__absolute/mobile/updates/production/update.json',
				{
					headers: {
						'x-absolute-mobile-app': config.appId,
						'x-absolute-mobile-channel': 'production',
						'x-absolute-mobile-installation': 'installation',
						'x-absolute-mobile-runtime': 'a'.repeat(64)
					}
				}
			)
		);
		expect(response.status).toBe(204);
		await expect(
			createAbsoluteMobileUpdateServerPlugin(config, projectRoot, {
				production: true
			})
		).rejects.toThrow('durable object storage');
	});
});
