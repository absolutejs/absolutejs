import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAbsoluteSyncSchema } from '../../../src/mobile/syncSchema';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const writeManifest = async (path: string, manifest: unknown) => {
	await mkdir(path, { recursive: true });
	await writeFile(
		join(path, 'package.json'),
		`${JSON.stringify(manifest)}\n`
	);
};

describe('generated AbsoluteJS Sync schema metadata', () => {
	test('uses the app v1 baseline for sites without a package manifest', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-sync-schema-empty-')
		);
		roots.push(root);

		expect(discoverAbsoluteSyncSchema(root)).toEqual({
			components: [
				{
					id: '@absolutejs/app',
					minimumCompatibleVersion: 1,
					version: 1
				}
			],
			sources: []
		});
	});

	test('composes the app and installed packs deterministically', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-sync-schema-'));
		roots.push(root);
		await writeManifest(root, {
			absolutejs: {
				sync: {
					localSchema: {
						migrations: [
							{ operations: [], toVersion: 2 },
							{ operations: [], toVersion: 3 }
						],
						version: 3
					}
				}
			},
			dependencies: {
				'@example/no-metadata': '1.0.0',
				'@example/tasks-pack': '1.0.0'
			},
			name: 'fixture-app'
		});
		await writeManifest(join(root, 'node_modules/@example/tasks-pack'), {
			absolutejs: {
				sync: {
					localSchema: {
						migrations: [
							{
								operations: [
									{
										collection: 'tasks',
										field: 'complete',
										type: 'set-default',
										value: false
									}
								],
								toVersion: 3
							},
							{ operations: [], toVersion: 4 }
						],
						version: 4
					}
				}
			},
			name: '@example/tasks-pack'
		});
		await writeManifest(join(root, 'node_modules/@example/no-metadata'), {
			name: '@example/no-metadata'
		});

		const discovered = discoverAbsoluteSyncSchema(root);
		expect(discovered.components.map(({ id }) => id)).toEqual([
			'@absolutejs/app',
			'@example/tasks-pack'
		]);
		expect(discovered.components).toMatchObject([
			{ id: '@absolutejs/app', minimumCompatibleVersion: 1, version: 3 },
			{
				id: '@example/tasks-pack',
				minimumCompatibleVersion: 2,
				version: 4
			}
		]);
		expect(JSON.parse(JSON.stringify(discovered.components))).toEqual(
			discovered.components
		);
	});

	test('rejects executable or incomplete package migration metadata', async () => {
		const root = await mkdtemp(
			join(tmpdir(), 'absolute-sync-schema-invalid-')
		);
		roots.push(root);
		await writeManifest(root, {
			absolutejs: {
				sync: {
					localSchema: {
						migrations: [
							{
								migrateCollection: 'not declarative',
								toVersion: 2
							}
						],
						version: 2
					}
				}
			},
			name: 'fixture-app'
		});

		expect(() => discoverAbsoluteSyncSchema(root)).toThrow(
			'not declarative metadata'
		);
	});
});
