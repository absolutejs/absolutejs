import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { defineComponent, h } from 'vue';
import { Elysia } from 'elysia';
import {
	resetSecureHeaders,
	secureHeaders,
	type SecureHeadersOptions
} from '../../../src/plugins/secureHeaders';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import { getCspNonce } from '../../../src/core/cspNonce';
import { handleHTMLPageRequest } from '../../../src/core/pageHandlers';
import { handleReactPageRequest } from '../../../src/react';
import { handleSveltePageRequest } from '../../../src/svelte';
import { handleVuePageRequest } from '../../../src/vue';

const SVELTE_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'svelte',
	'StreamingPage.svelte'
);

const originalNodeEnv = process.env.NODE_ENV;
const directories: string[] = [];

afterEach(() => {
	resetSecureHeaders();
	process.env.NODE_ENV = originalNodeEnv;
});

afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const policyOf = (response: Response) =>
	response.headers.get('content-security-policy') ?? '';

const nonceOf = (policy: string) =>
	policy.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? '';

/** The opening tag of every <script> and <style> in `html`. */
const inlineTags = (html: string) =>
	[...html.matchAll(/<(?:script|style)\b[^>]*>/gi)].map(([tag]) => tag);

const app = (options: SecureHeadersOptions = {}) =>
	new Elysia().use(secureHeaders(options)).use(absoluteRequestContext);

describe('secureHeaders()', () => {
	test('sends a nonce-based policy and the other headers', async () => {
		process.env.NODE_ENV = 'production';
		const server = app().get('/', ({ cspNonce }) => ({ cspNonce }));
		const response = await server.handle(new Request('http://site.test/'));
		const policy = policyOf(response);
		const nonce = nonceOf(policy);
		const body: { cspNonce: string } = await response.json();

		expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
		expect(body.cspNonce).toBe(nonce);
		expect(policy).toContain(
			`script-src 'self' 'strict-dynamic' 'nonce-${nonce}'`
		);
		expect(policy).toContain(`style-src 'self' 'nonce-${nonce}'`);
		expect(policy).toContain("frame-ancestors 'self'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
		expect(policy).not.toContain('ws://');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe(
			'strict-origin-when-cross-origin'
		);
		expect(response.headers.get('permissions-policy')).toContain(
			'camera=()'
		);
	});

	test('gives every request its own nonce', async () => {
		const server = app().get('/', () => 'ok');
		const [first, second] = await Promise.all([
			server.handle(new Request('http://site.test/')),
			server.handle(new Request('http://site.test/'))
		]);

		expect(nonceOf(policyOf(first))).not.toBe(nonceOf(policyOf(second)));
	});

	test('allows the HMR WebSocket in development only', async () => {
		process.env.NODE_ENV = 'development';
		const server = app().get('/', () => 'ok');
		const policy = policyOf(
			await server.handle(new Request('http://localhost:3000/'))
		);

		expect(policy).toContain(
			"connect-src 'self' ws://localhost:3000 wss://localhost:3000"
		);
	});

	test('every header and directive can be overridden or removed', async () => {
		const server = app({
			contentSecurityPolicy: {
				directives: {
					'img-src': ["'self'", 'https://cdn.example'],
					'object-src': false
				},
				reportOnly: true
			},
			frameAncestors: ["'none'"],
			permissionsPolicy: false,
			referrerPolicy: 'no-referrer'
		}).get('/', () => 'ok');
		const response = await server.handle(new Request('http://site.test/'));
		const policy =
			response.headers.get('content-security-policy-report-only') ?? '';

		expect(policyOf(response)).toBe('');
		expect(policy).toContain("img-src 'self' https://cdn.example");
		expect(policy).not.toContain('object-src');
		expect(policy).toContain("frame-ancestors 'none'");
		expect(response.headers.get('permissions-policy')).toBeNull();
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	});

	test('without the plugin there is no nonce', () => {
		expect(getCspNonce(new Request('http://site.test/'))).toBeUndefined();
	});
});

describe('page handlers under secureHeaders()', () => {
	const expectAllNonced = (html: string, policy: string) => {
		const nonce = nonceOf(policy);
		const tags = inlineTags(html);

		expect(nonce).not.toBe('');
		expect(tags.length).toBeGreaterThan(0);
		expect(tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual(
			[]
		);
	};

	test('React', async () => {
		const server = app().get('/', () =>
			handleReactPageRequest({
				index: '/react-index.js',
				props: { title: '</script><script>alert(1)</script>' },
				Page: () =>
					createElement(
						'html',
						null,
						createElement('body', null, 'react page')
					)
			})
		);
		const response = await server.handle(new Request('http://site.test/'));
		const html = await response.text();

		expectAllNonced(html, policyOf(response));
		expect(html).not.toContain('<script>alert(1)');
	});

	test('Svelte', async () => {
		const server = app().get('/', () =>
			handleSveltePageRequest({
				collectStreamingSlots: true,
				indexPath: '/svelte-index.js',
				pagePath: SVELTE_FIXTURE
			})
		);
		const response = await server.handle(new Request('http://site.test/'));

		expectAllNonced(await response.text(), policyOf(response));
	});

	test('Vue, with initial props that try to end the script', async () => {
		const server = app().get('/', () =>
			handleVuePageRequest({
				indexPath: '/vue-index.js',
				Page: defineComponent({ setup: () => () => h('h1', 'vue') }),
				pagePath: '/vue/pages/Page.js',
				props: { title: '</script><script>alert(1)</script>' }
			})
		);
		const response = await server.handle(new Request('http://site.test/'));
		const html = await response.text();

		expectAllNonced(html, policyOf(response));
		expect(html).not.toContain('<script>alert(1)');
	});

	test("HTML pages: the author's inline scripts and styles", async () => {
		const dir = await mkdtemp(join(tmpdir(), 'absolute-csp-html-'));
		directories.push(dir);
		const page = join(dir, 'Home.html');
		await writeFile(
			page,
			'<!doctype html><html><head><style>p{color:red}</style></head><body><p>hi</p><script>console.log(1)</script></body></html>'
		);
		const server = app().get('/', () => handleHTMLPageRequest(page));
		const response = await server.handle(new Request('http://site.test/'));

		expectAllNonced(await response.text(), policyOf(response));
	});
});
