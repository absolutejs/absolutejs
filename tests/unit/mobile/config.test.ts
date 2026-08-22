import { describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

describe('mobile config normalization', () => {
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
});
