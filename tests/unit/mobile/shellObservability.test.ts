import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	mock,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { installAbsoluteMobileShellObservability } from '../../../src/mobile/shellObservability';
import type { AbsoluteMobileClientManifest } from '../../../src/mobile/transport';

const originalFetch = globalThis.fetch;

beforeAll(() =>
	GlobalRegistrator.register({
		url: 'capacitor://localhost/account/ada?token=secret'
	})
);
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
	globalThis.fetch = originalFetch;
	Reflect.deleteProperty(globalThis, 'Capacitor');
});

const manifest: AbsoluteMobileClientManifest = {
	appBuild: 'ambuild_123',
	appId: 'com.example.product',
	appName: 'Product',
	deepLinkHosts: ['api.example.com'],
	deviceCapabilities: [],
	entry: '/account/ada',
	format: 1,
	nativeRuntime: 'a'.repeat(64),
	observability: {
		endpoint: 'https://api.example.com/api/observability/errors',
		environment: 'production',
		project: 'project-1',
		sampleRate: 1
	},
	pages: [
		{
			bundleHash: 'bundle-account',
			bundlePath: '/generated/Account.js',
			contract: 'account@1',
			framework: 'vue',
			localBundlePath: './pages/bundle-account.js',
			pageId: 'Account',
			propsSchemaHash: 'schema-account'
		}
	],
	productionOrigin: 'https://api.example.com',
	routes: [{ method: 'GET', pageId: 'Account', pattern: '/account/:id' }],
	runtime: '4'
};

describe('mobile shell observability', () => {
	test('reports redacted framework-neutral release context to the trusted server', async () => {
		const envelopes: Array<Record<string, unknown>> = [];
		globalThis.fetch = mock(async (input, init) => {
			expect(String(input)).toBe(
				'https://api.example.com/api/observability/errors'
			);
			envelopes.push(JSON.parse(String(init?.body)));

			return new Response(null, { status: 202 });
		}) as unknown as typeof fetch;
		Reflect.set(globalThis, 'Capacitor', {
			getPlatform: () => 'android'
		});
		const installed = installAbsoluteMobileShellObservability(
			manifest,
			'capacitor',
			globalThis.fetch
		);
		expect(installed).toBeDefined();
		installed?.captureException(
			new Error('navigation failed token=hunter2'),
			{
				path: '/account/grace?token=do-not-send',
				phase: 'navigation-load'
			}
		);
		await installed?.beacon.flush();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await installed?.beacon.close();

		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]).toMatchObject({
			environment: 'production',
			project: 'project-1',
			release: 'ambuild_123',
			v: 1
		});
		const [event] = envelopes[0]?.events as Array<Record<string, unknown>>;
		expect(event?.message).toBe('navigation failed token=[REDACTED]');
		expect(event?.tags).toMatchObject({
			absoluteMobile: 'true',
			mobileAppBuild: 'ambuild_123',
			mobileEngine: 'capacitor',
			mobileFailurePhase: 'navigation-load',
			mobileFramework: 'vue',
			mobileManifestFormat: '1',
			mobileNativeRuntime: 'a'.repeat(64),
			mobilePageBundle: 'bundle-account',
			mobilePageContract: 'account@1',
			mobilePageId: 'Account',
			mobilePlatform: 'android',
			mobileRoute: '/account/:id',
			mobileRuntime: '4'
		});
		expect(JSON.stringify(envelopes)).not.toContain('do-not-send');
		expect(JSON.stringify(envelopes)).not.toContain('hunter2');
	});

	test('stays absent unless the application configures a destination', () => {
		const { observability: _, ...disabled } = manifest;
		expect(
			installAbsoluteMobileShellObservability(disabled, 'expo')
		).toBeUndefined();
	});
});
