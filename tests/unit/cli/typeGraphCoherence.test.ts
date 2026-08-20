import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { typeGraphCoherence } from '../../../src/cli/typeGraphCoherence';

const temporaryDirectories: string[] = [];

const writePackage = async (
	directory: string,
	manifest: Record<string, unknown>
) => {
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, 'package.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`
	);
	await writeFile(join(directory, 'index.js'), 'export {};\n');
};

const fixture = async (duplicate: boolean) => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-type-graph-'));
	temporaryDirectories.push(directory);
	await writeFile(join(directory, 'bun.lock'), 'lock-v1');
	await writePackage(directory, {
		dependencies: { elysia: '2.0.0-beta.6', plugin: '1.0.0' },
		name: 'fixture',
		version: '1.0.0'
	});
	await writePackage(join(directory, 'node_modules', 'elysia'), {
		name: 'elysia',
		peerDependencies: { 'exact-mirror': '>=1.2.2', typebox: '>=1.3.0' },
		version: '2.0.0-beta.6'
	});
	await writePackage(join(directory, 'node_modules', 'typebox'), {
		name: 'typebox',
		version: '1.3.16'
	});
	await writePackage(join(directory, 'node_modules', 'exact-mirror'), {
		name: 'exact-mirror',
		version: '1.2.4'
	});
	const pluginDirectory = join(directory, 'node_modules', 'plugin');
	await writePackage(pluginDirectory, {
		name: 'plugin',
		peerDependencies: { elysia: '^2.0.0-beta.6' },
		version: '1.0.0'
	});
	if (duplicate) {
		const nestedElysia = join(pluginDirectory, 'node_modules', 'elysia');
		await writePackage(nestedElysia, {
			name: 'elysia',
			peerDependencies: {
				'exact-mirror': '>=1.2.2',
				typebox: '>=1.3.0'
			},
			version: '2.0.0-beta.5'
		});
		await writePackage(join(nestedElysia, 'node_modules', 'typebox'), {
			name: 'typebox',
			version: '1.3.15'
		});
		await writePackage(join(nestedElysia, 'node_modules', 'exact-mirror'), {
			name: 'exact-mirror',
			version: '1.2.2'
		});
	}

	return directory;
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('Elysia type graph coherence', () => {
	test('accepts one physical package identity across consumers', async () => {
		const directory = await fixture(false);
		const report = typeGraphCoherence.inspectTypeGraph(directory);

		expect(report.unresolved).toEqual([]);
		expect(typeGraphCoherence.duplicateTypeGraphPackages(report)).toEqual(
			[]
		);
	});

	test('inspects the invoked workspace package and ancestor install root', async () => {
		const directory = await fixture(false);
		await writePackage(directory, {
			name: 'workspace-root',
			version: '1.0.0',
			workspaces: ['apps/*']
		});
		const application = join(directory, 'apps', 'site');
		await writePackage(application, {
			dependencies: { elysia: '2.0.0-beta.6', plugin: '1.0.0' },
			name: 'site',
			version: '1.0.0'
		});
		const report = typeGraphCoherence.inspectTypeGraph(application);

		expect(report.installRoot).toBe(directory);
		expect(
			report.identities.some((identity) => identity.consumer === 'site')
		).toBeTrue();
		expect(typeGraphCoherence.duplicateTypeGraphPackages(report)).toEqual(
			[]
		);
	});

	test('finds peer-context duplicates and aligns root overrides', async () => {
		const directory = await fixture(true);
		const report = typeGraphCoherence.inspectTypeGraph(directory);

		expect(
			typeGraphCoherence
				.duplicateTypeGraphPackages(report)
				.map((entry) => entry.name)
		).toEqual(['elysia', 'typebox', 'exact-mirror']);
		expect(typeGraphCoherence.alignTypeGraphOverrides(report)).toEqual([
			'elysia@2.0.0-beta.6',
			'typebox@1.3.16',
			'exact-mirror@1.2.4'
		]);
		const manifest = await Bun.file(join(directory, 'package.json')).json();
		expect(manifest.overrides).toEqual({
			elysia: '2.0.0-beta.6',
			'exact-mirror': '1.2.4',
			typebox: '1.3.16'
		});
		expect(
			typeGraphCoherence.removeDuplicateTypeGraphPackages(report)
		).toHaveLength(3);
		expect(
			await Bun.file(
				join(
					directory,
					'node_modules',
					'plugin',
					'node_modules',
					'elysia',
					'package.json'
				)
			).exists()
		).toBeFalse();
	});
});
