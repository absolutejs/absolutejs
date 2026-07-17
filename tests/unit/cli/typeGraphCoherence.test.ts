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
		dependencies: { elysia: '1.4.29', plugin: '1.0.0' },
		name: 'fixture',
		version: '1.0.0'
	});
	await writePackage(join(directory, 'node_modules', 'elysia'), {
		dependencies: { '@sinclair/typebox': '0.34.52' },
		name: 'elysia',
		version: '1.4.29'
	});
	await writePackage(
		join(directory, 'node_modules', '@sinclair', 'typebox'),
		{ name: '@sinclair/typebox', version: '0.34.52' }
	);
	const pluginDirectory = join(directory, 'node_modules', 'plugin');
	await writePackage(pluginDirectory, {
		name: 'plugin',
		peerDependencies: { elysia: '^1.4.0' },
		version: '1.0.0'
	});
	if (duplicate) {
		const nestedElysia = join(pluginDirectory, 'node_modules', 'elysia');
		await writePackage(nestedElysia, {
			dependencies: { '@sinclair/typebox': '0.34.50' },
			name: 'elysia',
			version: '1.4.18'
		});
		await writePackage(
			join(nestedElysia, 'node_modules', '@sinclair', 'typebox'),
			{ name: '@sinclair/typebox', version: '0.34.50' }
		);
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
			dependencies: { elysia: '1.4.29', plugin: '1.0.0' },
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
		).toEqual(['elysia', '@sinclair/typebox']);
		expect(typeGraphCoherence.alignTypeGraphOverrides(report)).toEqual([
			'elysia@1.4.29',
			'@sinclair/typebox@0.34.52'
		]);
		const manifest = await Bun.file(join(directory, 'package.json')).json();
		expect(manifest.overrides).toEqual({
			'@sinclair/typebox': '0.34.52',
			elysia: '1.4.29'
		});
		expect(
			typeGraphCoherence.removeDuplicateTypeGraphPackages(report)
		).toHaveLength(2);
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
