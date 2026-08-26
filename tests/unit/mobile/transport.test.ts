import { describe, expect, test } from 'bun:test';
import {
	createAbsoluteMobilePageRequest,
	resolveAbsoluteMobileDeepLink,
	resolveAbsoluteMobileNavigation,
	type AbsoluteMobileClientManifest
} from '../../../src/mobile/transport';
import { MOBILE_PAGE_REQUEST_HEADERS } from '../../../src/mobile/pageProtocol';

const manifest: AbsoluteMobileClientManifest = {
	appBuild: 'build-1',
	appId: 'com.example.product',
	appName: 'Product',
	deepLinkHosts: ['example.com'],
	deepLinkScheme: 'product',
	deviceCapabilities: [],
	entry: '/',
	format: 1,
	pages: [
		{
			bundleHash: 'bundle-account',
			bundlePath: '/generated/account.js',
			contract: 'account@1',
			framework: 'react',
			localBundlePath: './pages/account.js',
			pageId: 'Account',
			propsSchemaHash: 'schema-account'
		}
	],
	productionOrigin: 'https://api.example.com',
	routes: [{ method: 'GET', pageId: 'Account', pattern: '/account/:id' }],
	runtime: '1'
};

describe('mobile canonical transport', () => {
	test('targets the deployed backend with the embedded page identity', () => {
		const request = createAbsoluteMobilePageRequest(
			manifest,
			'/account/Ada?tab=profile',
			{ headers: { authorization: 'Bearer mobile-token' } }
		);

		expect(request.url).toBe(
			'https://api.example.com/account/Ada?tab=profile'
		);
		expect(request.headers.get('authorization')).toBe(
			'Bearer mobile-token'
		);
		expect(request.headers.get(MOBILE_PAGE_REQUEST_HEADERS.pageId)).toBe(
			'Account'
		);
		expect(
			request.headers.get(MOBILE_PAGE_REQUEST_HEADERS.pageBundle)
		).toBe('bundle-account');
	});

	test('maps only configured HTTPS and custom-scheme deep links', () => {
		expect(
			resolveAbsoluteMobileDeepLink(
				manifest,
				'https://example.com/account/Ada?tab=profile'
			)
		).toBe('/account/Ada?tab=profile');
		expect(
			resolveAbsoluteMobileDeepLink(
				manifest,
				'product://open/account/Ada'
			)
		).toBe('/account/Ada');
		expect(() =>
			resolveAbsoluteMobileDeepLink(
				manifest,
				'https://attacker.example/account/Ada'
			)
		).toThrow('outside');
	});

	test('routes embedded and production-origin links without capturing external links', () => {
		expect(
			resolveAbsoluteMobileNavigation(
				manifest,
				'capacitor://localhost/vue?tab=one#title',
				'capacitor://localhost'
			)
		).toBe('/vue?tab=one#title');
		expect(
			resolveAbsoluteMobileNavigation(
				manifest,
				'https://api.example.com/react',
				'capacitor://localhost'
			)
		).toBe('/react');
		expect(
			resolveAbsoluteMobileNavigation(
				manifest,
				'https://evil.example/phish',
				'capacitor://localhost'
			)
		).toBeUndefined();
	});
});
