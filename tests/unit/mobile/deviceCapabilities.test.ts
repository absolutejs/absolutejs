import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	assertAbsoluteDeviceCapabilityPackages,
	discoverAbsoluteDeviceCapabilities,
	loadAbsoluteDeviceCapabilityProviders,
	missingAbsoluteDeviceCapabilityPackages,
	resolveAbsoluteDeviceCapabilityPlan
} from '../../../src/mobile/deviceCapabilities';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const fixture = async () => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-device-capabilities-'));
	temporaryDirectories.push(root);
	const manifest = join(
		root,
		'node_modules/@absolutejs/devices-capacitor/package.json'
	);
	await mkdir(dirname(manifest), { recursive: true });
	await writeFile(
		manifest,
		JSON.stringify({
			absolutejs: {
				devices: {
					capabilities: {
						camera: {
							factory: 'createCapacitorCameraCapability',
							module: '@absolutejs/devices-capacitor/camera',
							native: {
								ios: {
									usageDescriptions: [
										'camera',
										'photo-library'
									]
								}
							},
							packages: ['@capacitor/camera@8.2.3']
						},
						clipboard: {
							factory: 'createCapacitorClipboardCapability',
							module: '@absolutejs/devices-capacitor/clipboard',
							packages: ['@capacitor/clipboard@8.0.1']
						},
						haptics: {
							factory: 'createCapacitorHapticsCapability',
							module: '@absolutejs/devices-capacitor/haptics',
							packages: ['@capacitor/haptics@8.0.2']
						},
						share: {
							factory: 'createCapacitorShareCapability',
							module: '@absolutejs/devices-capacitor/share',
							packages: ['@capacitor/share@8.0.1']
						}
					},
					format: 1,
					provider: 'capacitor'
				}
			}
		})
	);

	return root;
};

describe('device capability discovery', () => {
	test('finds value imports, aliases, namespaces, and re-exports deterministically', async () => {
		const root = await fixture();
		await writeFile(
			join(root, 'page.ts'),
			`import { clipboard as copy, type DeviceShareContent } from '@absolutejs/devices';
import * as device from '@absolutejs/devices';
void copy.writeText('x'); void device.haptics.impact();`
		);
		await writeFile(
			join(root, 'feature.ts'),
			`export { share } from '@absolutejs/devices';`
		);
		await mkdir(join(root, 'tests'), { recursive: true });
		await writeFile(
			join(root, 'tests/ignored.ts'),
			`import { share } from '@absolutejs/devices';`
		);
		await mkdir(join(root, 'node_modules/ignored'), { recursive: true });
		await writeFile(
			join(root, 'node_modules/ignored/index.ts'),
			`import { share } from '@absolutejs/devices';`
		);

		const providers = loadAbsoluteDeviceCapabilityProviders(root);
		expect(discoverAbsoluteDeviceCapabilities(root, providers)).toEqual([
			'clipboard',
			'haptics',
			'share'
		]);
		const plan = resolveAbsoluteDeviceCapabilityPlan(root);
		expect(plan.requiredPackages).toEqual([
			'@capacitor/clipboard@8.0.1',
			'@capacitor/haptics@8.0.2',
			'@capacitor/share@8.0.1'
		]);
		expect(
			missingAbsoluteDeviceCapabilityPackages(
				plan,
				new Set(['@capacitor/clipboard'])
			)
		).toEqual(['@capacitor/haptics@8.0.2', '@capacitor/share@8.0.1']);
	});

	test('ignores type-only imports and test sources', async () => {
		const root = await fixture();
		await writeFile(
			join(root, 'page.ts'),
			`import type { DeviceClipboardCapability } from '@absolutejs/devices';`
		);
		await mkdir(join(root, 'tests'), { recursive: true });
		await writeFile(
			join(root, 'tests/device.test.ts'),
			`import { clipboard } from '@absolutejs/devices';`
		);

		expect(resolveAbsoluteDeviceCapabilityPlan(root).capabilities).toEqual(
			[]
		);
	});

	test('discovers imports inside Vue and Svelte script blocks', async () => {
		const root = await fixture();
		await writeFile(
			join(root, 'Page.vue'),
			`<template><button>Share</button></template><script setup lang="ts">import { share } from '@absolutejs/devices'; void share;</script>`
		);
		await writeFile(
			join(root, 'Widget.svelte'),
			`<script lang="ts">import { haptics } from '@absolutejs/devices'; void haptics;</script><button>Tap</button>`
		);

		expect(resolveAbsoluteDeviceCapabilityPlan(root).capabilities).toEqual([
			'haptics',
			'share'
		]);
	});

	test('requires the exact installed provider version', async () => {
		const root = await fixture();
		await writeFile(
			join(root, 'page.ts'),
			`import { clipboard } from '@absolutejs/devices';`
		);
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({
				dependencies: { '@capacitor/clipboard': '8.0.1' }
			})
		);
		const pluginManifest = join(
			root,
			'node_modules/@capacitor/clipboard/package.json'
		);
		await mkdir(dirname(pluginManifest), { recursive: true });
		await writeFile(pluginManifest, JSON.stringify({ version: '8.0.0' }));

		expect(() =>
			assertAbsoluteDeviceCapabilityPackages(
				root,
				resolveAbsoluteDeviceCapabilityPlan(root)
			)
		).toThrow('@capacitor/clipboard@8.0.1');
	});

	test('rejects executable or unpinned provider metadata', async () => {
		const root = await fixture();
		const path = join(
			root,
			'node_modules/@absolutejs/devices-capacitor/package.json'
		);
		const value = JSON.parse(await Bun.file(path).text());
		value.absolutejs.devices.capabilities.share.packages = [
			'@capacitor/share@latest'
		];
		await writeFile(path, JSON.stringify(value));

		expect(() => loadAbsoluteDeviceCapabilityProviders(root)).toThrow(
			'exact official Capacitor package versions'
		);
	});

	test('parses declarative native requirements and rejects unknown purposes', async () => {
		const root = await fixture();
		const path = join(
			root,
			'node_modules/@absolutejs/devices-capacitor/package.json'
		);
		const providers = loadAbsoluteDeviceCapabilityProviders(root);
		expect(providers.camera?.native?.ios?.usageDescriptions).toEqual([
			'camera',
			'photo-library'
		]);
		const value = JSON.parse(await Bun.file(path).text());
		value.absolutejs.devices.capabilities.camera.native.ios.usageDescriptions =
			['contacts'];
		await writeFile(path, JSON.stringify(value));
		expect(() => loadAbsoluteDeviceCapabilityProviders(root)).toThrow(
			'unsupported purpose'
		);
	});
});
