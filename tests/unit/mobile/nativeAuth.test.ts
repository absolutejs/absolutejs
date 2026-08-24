import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';
import {
	createAbsoluteMobileAuthManifest,
	installAbsoluteMobileAuthEnvironment,
	projectUsesAbsoluteAuth,
	projectUsesAbsoluteSync,
	resolveAbsoluteMobileAuthManifest,
	serializeAbsoluteMobileAuthEnvironment
} from '../../../src/mobile/nativeAuth';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const mobileConfig = (root: string) =>
	normalizeAbsoluteMobileConfig(
		{
			appId: 'com.example.product',
			appName: 'Product',
			server: { productionOrigin: 'https://api.example.com' }
		},
		root
	);

describe('automatic mobile auth provisioning', () => {
	test('activates only when the project declares @absolutejs/auth', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-native-auth-'));
		directories.push(root);
		await Bun.write(
			join(root, 'package.json'),
			JSON.stringify({ dependencies: { '@absolutejs/auth': '0.69.0' } })
		);
		expect(projectUsesAbsoluteAuth(root)).toBe(true);
		expect(projectUsesAbsoluteSync(root)).toBe(false);
		expect(
			resolveAbsoluteMobileAuthManifest(root, mobileConfig(root))
		).toEqual(createAbsoluteMobileAuthManifest(mobileConfig(root)));
	});

	test('keeps mobile bundles auth-free when the package is absent', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-no-native-auth-'));
		directories.push(root);
		await Bun.write(join(root, 'package.json'), '{}');
		expect(
			resolveAbsoluteMobileAuthManifest(root, mobileConfig(root))
		).toBeUndefined();
	});

	test('derives a stable public client and runtime declaration', () => {
		const config = mobileConfig('/workspace');
		const auth = createAbsoluteMobileAuthManifest(config);
		expect(auth).toEqual({
			clientId: 'absolutejs-native:com.example.product',
			issuer: 'https://api.example.com',
			redirectUri: 'com.example.product://auth/callback',
			scopes: ['openid', 'profile']
		});
		const serialized = serializeAbsoluteMobileAuthEnvironment(config, auth);
		expect(serialized).toBeDefined();
		if (serialized === undefined) throw new Error('Expected native auth');
		expect(JSON.parse(serialized)).toEqual([
			{
				...auth,
				name: 'Product native app'
			}
		]);
	});

	test('installs and removes the server provisioning declaration', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-auth-env-'));
		directories.push(root);
		await Bun.write(
			join(root, 'package.json'),
			JSON.stringify({ dependencies: { '@absolutejs/auth': '0.69.0' } })
		);
		const config = mobileConfig(root);
		installAbsoluteMobileAuthEnvironment(root, config);
		expect(process.env.ABSOLUTE_AUTH_NATIVE_CLIENTS).toContain(
			'absolutejs-native:com.example.product'
		);
		await Bun.write(join(root, 'package.json'), '{}');
		installAbsoluteMobileAuthEnvironment(root, config);
		expect(process.env.ABSOLUTE_AUTH_NATIVE_CLIENTS).toBeUndefined();
	});
});
