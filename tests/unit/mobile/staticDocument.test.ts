import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	hashAbsoluteMobileStaticDocument,
	installAbsoluteMobileStaticDocument,
	rewriteAbsoluteMobileHtmxRequests,
	sanitizeAbsoluteMobileHtmxFragment
} from '../../../src/mobile/staticDocument';
import type {
	AbsoluteMobileClientManifest,
	AbsoluteMobileClientPage
} from '../../../src/mobile/transport';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('mobile static documents', () => {
	test('rewrites root-relative form and HTMX requests to the deployed backend', () => {
		const source =
			'<form action="/save"><button hx-post="/count">Count</button></form><div hx-get="https://api.example.com/status"></div>';

		expect(
			rewriteAbsoluteMobileHtmxRequests(source, 'https://api.example.com')
		).toBe(
			'<form action="https://api.example.com/save"><button hx-post="https://api.example.com/count">Count</button></form><div hx-get="https://api.example.com/status"></div>'
		);
	});

	test('strips executable and cross-origin behavior from server fragments', () => {
		const sanitized = sanitizeAbsoluteMobileHtmxFragment(
			`<section style="background:red" onclick="steal()" hx-on:load="steal()">
				<script>steal()</script>
				<iframe></iframe>
				<button hx-post="https://evil.example/pwn">Bad</button>
				<button hx-post="/safe">Safe</button>
				<a href="javascript:steal()">Unsafe link</a>
			</section>`,
			'https://api.example.com'
		);

		expect(sanitized).not.toContain('script');
		expect(sanitized).not.toContain('iframe');
		expect(sanitized).not.toContain('onclick');
		expect(sanitized).not.toContain('hx-on');
		expect(sanitized).toContain('style="background:red"');
		expect(sanitized).not.toContain('evil.example');
		expect(sanitized).not.toContain('javascript:');
		expect(sanitized).toContain('hx-post="https://api.example.com/safe"');
	});

	test('uses a deterministic SHA-256 integrity identity', async () => {
		expect(await hashAbsoluteMobileStaticDocument('<h1>Hello</h1>')).toBe(
			'e2c6c0ea7c7900c31f953e48d30d5e839801ab90630d751e7c8426ed5859da47'
		);
	});

	test('installs a trusted document without destroying shell listeners', async () => {
		const source =
			'<!doctype html><html lang="en"><head><title>Mobile HTML</title></head><body class="page"><a href="/next">Next</a></body></html>';
		const bundleHash = await hashAbsoluteMobileStaticDocument(source);
		const page: AbsoluteMobileClientPage = {
			bundleHash,
			bundlePath: '/html/page.html',
			contract: 'html:test:contract',
			framework: 'html',
			localBundlePath: './pages/page.html',
			pageId: 'html:Test',
			propsSchemaHash: 'schema'
		};
		const manifest: AbsoluteMobileClientManifest = {
			appBuild: 'build',
			appId: 'com.example.app',
			appName: 'Example',
			deepLinkHosts: [],
			deviceCapabilities: [],
			entry: '/',
			format: 1,
			pages: [page],
			productionOrigin: 'https://api.example.com',
			routes: [],
			runtime: '1'
		};
		let shellEvents = 0;
		const listener = () => shellEvents++;
		const previousFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(source)) as unknown as typeof fetch;
		addEventListener('absolute-shell-probe', listener);
		try {
			await installAbsoluteMobileStaticDocument(
				manifest,
				page,
				'https://localhost/pages/page.html?absoluteNavigation=2'
			);
			dispatchEvent(new Event('absolute-shell-probe'));

			expect(document.title).toBe('Mobile HTML');
			expect(document.documentElement.lang).toBe('en');
			expect(document.body.className).toBe('page');
			expect(document.querySelector('a')?.getAttribute('href')).toBe(
				'/next'
			);
			expect(shellEvents).toBe(1);
		} finally {
			removeEventListener('absolute-shell-probe', listener);
			globalThis.fetch = previousFetch;
		}
	});
});
