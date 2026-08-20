import { describe, expect, test } from 'bun:test';
import { normalizeAbsoluteMobileConfig } from '../../../src/mobile/config';

describe('mobile config normalization', () => {
	test('normalizes the Capacitor app without a route list', () => {
		const config = normalizeAbsoluteMobileConfig(
			{
				appId: 'com.example.product',
				appName: 'Product',
				deepLinks: { hosts: ['APP.EXAMPLE.COM'], scheme: 'Product' },
				server: { productionOrigin: 'https://api.example.com' }
			},
			'/workspace'
		);

		expect(config).toMatchObject({
			appId: 'com.example.product',
			appName: 'Product',
			bundleDirectory: '/workspace/.absolutejs/mobile/web',
			deepLinkHosts: ['api.example.com', 'app.example.com'],
			deepLinkScheme: 'product',
			entry: '/',
			nativeProjectDirectory: '/workspace/mobile',
			platforms: ['ios', 'android'],
			productionOrigin: 'https://api.example.com'
		});
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
});
