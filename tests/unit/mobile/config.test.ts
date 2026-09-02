import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

describe('mobile config normalization', () => {
	test('normalizes a signed update channel without accepting private material', () => {
		const { publicKey } = generateKeyPairSync('ec', {
			namedCurve: 'prime256v1'
		});
		const encoded = publicKey
			.export({ format: 'der', type: 'spki' })
			.toString('base64');
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				server: { productionOrigin: 'https://api.example.com' },
				updates: { publicKeys: { 'production-2026': encoded } }
			},
			'/workspace'
		);

		expect(config.updates).toEqual({
			bootTimeoutMs: 20_000,
			channel: 'production',
			manifestUrl:
				'https://api.example.com/__absolute/mobile/updates/production/update.json',
			publicKeys: { 'production-2026': encoded }
		});
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					server: { productionOrigin: 'https://api.example.com' },
					updates: { publicKeys: {} }
				},
				'/workspace'
			)
		).toThrow('at least one key');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					server: { productionOrigin: 'https://api.example.com' },
					updates: {
						bootTimeoutMs: 4999,
						publicKeys: { 'production-2026': encoded }
					}
				},
				'/workspace'
			)
		).toThrow('bootTimeoutMs');
	});
	test('normalizes the Capacitor app without a route list', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				deepLinks: {
					android: {
						sha256CertificateFingerprints: ['aa'.repeat(32)]
					},
					apple: { appIdPrefix: 'abcde12345' },
					hosts: ['APP.EXAMPLE.COM'],
					scheme: 'Product'
				},
				ios: { version: '1.4.0' },
				server: { productionOrigin: 'https://api.example.com' }
			},
			'/workspace'
		);

		expect(config).toMatchObject({
			androidCertificateFingerprints: [
				'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA'
			],
			appId: 'com.example.product',
			appleAppIdPrefix: 'ABCDE12345',
			appName: 'Product',
			bundleDirectory: '/workspace/.absolutejs/mobile/web',
			deepLinkHosts: ['api.example.com', 'app.example.com'],
			deepLinkScheme: 'product',
			entry: '/',
			iosVersion: '1.4.0',
			nativeProjectDirectory: '/workspace/mobile',
			platforms: ['ios', 'android'],
			productionOrigin: 'https://api.example.com'
		});
	});

	test('validates the explicit iOS marketing version', () => {
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					ios: { version: 'v1' },
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('mobile.ios.version');
	});

	test('derives a native callback scheme from appId', () => {
		expect(
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.Example.Product',
					appName: 'Product',
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			).deepLinkScheme
		).toBe('com.example.product');
	});

	test('rejects a remote production WebView and ambiguous app identity', () => {
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'Product',
					appName: 'Product',
					server: { productionOrigin: 'http://example.com/app' }
				},
				'/workspace'
			)
		).toThrow('reverse-domain');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					server: { productionOrigin: 'http://example.com' }
				},
				'/workspace'
			)
		).toThrow('HTTPS');
	});

	test('allows HTTP only for an emulator loopback backend', () => {
		for (const productionOrigin of [
			'http://localhost:39080',
			'http://127.0.0.1:39080',
			'http://[::1]:39080'
		]) {
			expect(
				normalizeAbsoluteMobileConfig(
					{
						appId: 'com.example.product',
						appName: 'Product',
						server: { productionOrigin }
					},
					'/workspace'
				).productionOrigin
			).toBe(productionOrigin);
		}
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					server: { productionOrigin: 'http://192.168.1.20:39080' }
				},
				'/workspace'
			)
		).toThrow('HTTPS');
	});

	test('rejects unsafe hosts and malformed signing identities', () => {
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					deepLinks: { hosts: ['../outside'] },
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('valid hostnames');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					deepLinks: {
						android: {
							sha256CertificateFingerprints: ['not-a-certificate']
						}
					},
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('SHA-256');
	});

	test('normalizes the experimental Expo shell and explicit native routes', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				engine: 'expo',
				routes: { native: { '/scanner': 'mobile/native/scanner.tsx' } },
				server: { productionOrigin: 'https://example.com' }
			},
			'/workspace'
		);

		expect(config).toMatchObject({
			engine: 'expo',
			expoNativeRoutes: {
				'/scanner': '/workspace/mobile/native/scanner.tsx'
			},
			expoSdkVersion: 57,
			nativeProjectDirectory: '/workspace/.absolutejs/mobile/expo'
		});
	});

	test('normalizes parameterized and terminal-wildcard Expo native routes', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				engine: 'expo',
				routes: {
					native: {
						'/files/*': 'mobile/native/files.tsx',
						'/products/:productId': 'mobile/native/product.tsx'
					}
				},
				server: { productionOrigin: 'https://example.com' }
			},
			'/workspace'
		);

		expect(config.expoNativeRoutes).toEqual({
			'/files/*': '/workspace/mobile/native/files.tsx',
			'/products/:productId': '/workspace/mobile/native/product.tsx'
		});
	});

	test('rejects unsafe Expo native route ownership', () => {
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					engine: 'expo',
					routes: {
						native: { '/__absolute/native': 'native.tsx' }
					},
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('reserves /__absolute/native');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					engine: 'expo',
					routes: { native: { '/*': 'native.tsx' } },
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('final segment after');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					engine: 'expo',
					routes: {
						native: {
							'/account/:id': 'account.tsx',
							'/account/:name': 'other-account.tsx'
						}
					},
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('claim the same Expo route pattern');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					engine: 'expo',
					routes: {
						native: { '/account/:bad-name': 'account.tsx' }
					},
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('invalid parameter');
		expect(() =>
			normalizeAbsoluteMobileConfig(
				{
					appId: 'com.example.product',
					appName: 'Product',
					engine: 'expo',
					routes: { native: { '/assets/:id': 'asset.tsx' } },
					server: { productionOrigin: 'https://example.com' }
				},
				'/workspace'
			)
		).toThrow('reserved path');
	});
});
