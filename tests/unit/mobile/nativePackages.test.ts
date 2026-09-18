import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	ABSOLUTE_DEVICES_VERSION,
	ABSOLUTE_EXPO_DEVICES_VERSION,
	ABSOLUTE_NATIVE_EXACT_PACKAGES,
	CAPACITOR_PACKAGE_SPECS,
	CAPACITOR_SYNC_PACKAGE_SPECS,
	assertNativePackageVersions,
	packageNameFromSpec,
	packagesNeedingExactInstall
} from '../../../src/mobile/nativePackages';

const temporary: string[] = [];
afterEach(async () => {
	for (const directory of temporary.splice(0))
		await rm(directory, { force: true, recursive: true });
});
const specs = [...CAPACITOR_PACKAGE_SPECS, ...CAPACITOR_SYNC_PACKAGE_SPECS];
const declared = new Set(specs.map(packageNameFromSpec));
const fixture = async (versions: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-native-packages-'));
	temporary.push(root);
	for (const [name, version] of Object.entries(versions)) {
		const path = join(root, 'node_modules', name, 'package.json');
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify({ name, version }));
	}

	return root;
};

test('repairs stale Devices and Sync adapters, not just missing packages', async () => {
	const root = await fixture({
		'@absolutejs/devices': '0.5.0',
		'@absolutejs/devices-capacitor': '0.6.1',
		'@absolutejs/sync-capacitor': '0.9.1'
	});
	expect(
		await packagesNeedingExactInstall(
			root,
			specs,
			declared,
			ABSOLUTE_NATIVE_EXACT_PACKAGES
		)
	).toEqual([
		'@absolutejs/devices@0.7.0',
		'@absolutejs/devices-capacitor@0.8.0',
		'@absolutejs/sync-capacitor@0.9.3'
	]);
});

test('matching native versions are idempotent and missing installs are repaired', async () => {
	const root = await fixture(
		Object.fromEntries(
			specs.map((spec) => [
				packageNameFromSpec(spec),
				spec.slice(spec.lastIndexOf('@') + 1)
			])
		)
	);
	expect(
		await packagesNeedingExactInstall(
			root,
			specs,
			declared,
			ABSOLUTE_NATIVE_EXACT_PACKAGES
		)
	).toEqual([]);
	expect(
		await packagesNeedingExactInstall(
			root,
			specs,
			new Set(),
			ABSOLUTE_NATIVE_EXACT_PACKAGES
		)
	).toEqual(specs);
	await writeFile(
		join(root, 'node_modules/@absolutejs/sync-capacitor/package.json'),
		'invalid'
	);
	expect(
		await packagesNeedingExactInstall(
			root,
			specs,
			declared,
			ABSOLUTE_NATIVE_EXACT_PACKAGES
		)
	).toEqual(['@absolutejs/sync-capacitor@0.9.3']);
});

test('accepts hoisted packages but rejects stale or malformed nearer installations', async () => {
	const root = await fixture(
		Object.fromEntries(
			specs.map((spec) => [
				packageNameFromSpec(spec),
				spec.slice(spec.lastIndexOf('@') + 1)
			])
		)
	);
	const app = join(root, 'packages/app');
	await mkdir(app, { recursive: true });
	await expect(
		assertNativePackageVersions(app, specs, ABSOLUTE_NATIVE_EXACT_PACKAGES)
	).resolves.toBeUndefined();
	const shadow = join(
		app,
		'node_modules/@absolutejs/sync-capacitor/package.json'
	);
	await mkdir(dirname(shadow), { recursive: true });
	await writeFile(shadow, JSON.stringify({ version: '0.9.1' }));
	await expect(
		assertNativePackageVersions(app, specs, ABSOLUTE_NATIVE_EXACT_PACKAGES)
	).rejects.toThrow('stale workspace-local installation');
	await writeFile(shadow, '{');
	await expect(
		assertNativePackageVersions(app, specs, ABSOLUTE_NATIVE_EXACT_PACKAGES)
	).rejects.toThrow('@absolutejs/sync-capacitor@0.9.3');
});

test('provisioned Capacitor versions match installed framework dependencies and peer contracts', async () => {
	const root = resolve(import.meta.dir, '../../..');
	const selected = Object.fromEntries(
		specs.map((spec) => [
			packageNameFromSpec(spec),
			spec.slice(spec.lastIndexOf('@') + 1)
		])
	);
	for (const name of ABSOLUTE_NATIVE_EXACT_PACKAGES) {
		const manifest = JSON.parse(
			await readFile(
				join(root, 'node_modules', name, 'package.json'),
				'utf8'
			)
		);
		expect(manifest.version).toBe(selected[name]);
		for (const [peer, range] of Object.entries(
			manifest.peerDependencies ?? {}
		)) {
			if (typeof range === 'string' && selected[peer])
				expect(Bun.semver.satisfies(selected[peer], range)).toBe(true);
		}
	}
});

test('Sync and the application resolve one Devices runtime pair', () => {
	const root = resolve(import.meta.dir, '../../..');
	const adapter = dirname(
		Bun.resolveSync('@absolutejs/sync-capacitor', root)
	);
	for (const name of [
		'@absolutejs/devices',
		'@absolutejs/devices-capacitor'
	]) {
		expect(Bun.resolveSync(name, adapter)).toBe(
			Bun.resolveSync(name, root)
		);
	}
});

test('Expo shell pins share the tested Devices core and satisfy adapter peers', async () => {
	const root = resolve(import.meta.dir, '../../..');
	const manifest = JSON.parse(
		await readFile(
			join(root, 'node_modules/@absolutejs/devices-expo/package.json'),
			'utf8'
		)
	);
	expect(manifest.version).toBe(ABSOLUTE_EXPO_DEVICES_VERSION);
	expect(
		Bun.semver.satisfies(
			ABSOLUTE_DEVICES_VERSION,
			manifest.peerDependencies['@absolutejs/devices']
		)
	).toBe(true);
});
