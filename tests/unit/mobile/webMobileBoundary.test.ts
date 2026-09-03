import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeAbsoluteMobilePage } from '../../../src/mobile/pageProtocol';
import { buildAbsoluteMobilePreviewClient } from '../../../src/mobile/mobilePreviewClientBundle';

const hmrClientSource = readFileSync(
	resolve(import.meta.dir, '../../../src/dev/client/hmrClient.ts'),
	'utf8'
);

type FinalizeInput = Parameters<
	typeof finalizeAbsoluteMobilePage<Record<string, never>>
>[0];

const browserPageInput = (request: Request | undefined) => {
	const input = { props: {}, request } as FinalizeInput;
	Object.defineProperty(input, 'compatibility', {
		get() {
			throw new Error(
				'compatibility must not be read for a browser request'
			);
		}
	});

	return input;
};

const withBrowserGlobals = async (run: () => Promise<void>) => {
	const previous = new Map<string, unknown>();
	const stubs: Record<string, unknown> = {
		history: { length: 1 },
		location: {
			href: 'http://localhost:3000/account',
			origin: 'http://localhost:3000',
			search: ''
		},
		parent: globalThis,
		window: globalThis,
		addEventListener: () => undefined
	};
	for (const [key, value] of Object.entries(stubs)) {
		previous.set(key, Reflect.get(globalThis, key));
		Reflect.set(globalThis, key, value);
	}
	try {
		await run();
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) Reflect.deleteProperty(globalThis, key);
			else Reflect.set(globalThis, key, value);
		}
	}
};

describe('web / mobile boundary', () => {
	test('the HMR client only reaches the mobile preview through a dev-server URL', () => {
		expect(hmrClientSource).not.toMatch(/from\s*['"]\.\.\/\.\.\/mobile\//);
		expect(hmrClientSource).not.toMatch(
			/import\s*\(\s*['"]\.\.\/\.\.\/mobile\//
		);
		expect(hmrClientSource).toContain(
			"'/__absolute/mobile-preview-client.js'"
		);
	});

	test('importing the preview client leaves fetch untouched until it is installed', async () => {
		const originalFetch = globalThis.fetch;
		const stubFetch = Object.assign(
			(_input: RequestInfo | URL, _init?: RequestInit) =>
				Promise.resolve(new Response(null)),
			{ preconnect: () => undefined }
		);
		globalThis.fetch = stubFetch;
		try {
			await withBrowserGlobals(async () => {
				const previewClient = await import(
					'../../../src/mobile/mobilePreviewClient'
				);
				expect(globalThis.fetch).toBe(stubFetch);
				expect(Reflect.has(globalThis, '__ABS_MOBILE_PREVIEW__')).toBe(
					false
				);

				previewClient.installAbsoluteMobilePreview();
				expect(globalThis.fetch).not.toBe(stubFetch);
				expect(Reflect.has(globalThis, '__ABS_MOBILE_PREVIEW__')).toBe(
					true
				);

				const installed = globalThis.fetch;
				previewClient.installAbsoluteMobilePreview();
				expect(globalThis.fetch).toBe(installed);
			});
		} finally {
			globalThis.fetch = originalFetch;
			Reflect.deleteProperty(globalThis, '__ABS_MOBILE_PREVIEW__');
		}
	});

	test('the served preview client shares vendored packages with page code', async () => {
		const vendorPaths: Record<string, string> = {
			'@absolutejs/devices': '/vendor/_absolutejs_devices.js',
			'@absolutejs/devices/testing':
				'/vendor/_absolutejs_devices_testing.js',
			'@absolutejs/http': '/vendor/_absolutejs_http.js'
		};
		const shared = await buildAbsoluteMobilePreviewClient(vendorPaths);
		for (const vendorPath of Object.values(vendorPaths)) {
			expect(shared).toContain(`from "${vendorPath}"`);
		}
		expect(shared).not.toMatch(/from\s*["']@absolutejs\//);
		expect(shared).toContain('installAbsoluteMobilePreview');

		const standalone = await buildAbsoluteMobilePreviewClient({});
		expect(standalone).not.toMatch(/^import\s/m);
		expect(standalone).toContain('installAbsoluteMobilePreview');
	});

	test('finalizeAbsoluteMobilePage ignores browser requests before reading compatibility', () => {
		expect(
			finalizeAbsoluteMobilePage(
				browserPageInput(
					new Request('https://example.test/account', {
						headers: { accept: 'text/html' }
					})
				)
			)
		).toBeUndefined();
		expect(
			finalizeAbsoluteMobilePage(
				browserPageInput(
					new Request('https://example.test/account', {
						headers: {
							accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
						}
					})
				)
			)
		).toBeUndefined();
		expect(
			finalizeAbsoluteMobilePage(
				browserPageInput(new Request('https://example.test/account'))
			)
		).toBeUndefined();
		expect(
			finalizeAbsoluteMobilePage(browserPageInput(undefined))
		).toBeUndefined();
	});
});
