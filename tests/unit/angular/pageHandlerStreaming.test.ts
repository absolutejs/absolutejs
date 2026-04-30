import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { handleAngularPageRequest } from '../../../src/angular';

const FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'streaming-page.ts'
);
const DEFER_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'defer-streaming-page.ts'
);
const REQUEST_PROVIDER_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'request-provider-page.ts'
);
const LEGACY_ANIMATION_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'legacy-animation-page.ts'
);
const ASYNC_ROUTE_RESOLVER_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'async-route-resolver-page.ts'
);
const DETERMINISTIC_ENV_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'deterministic-env-page.ts'
);
const PROVIDER_MODEL_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'page-provider-model-page.ts'
);
const ROUTE_PROVIDER_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'route-provider-page.ts'
);
const EXTERNAL_LOAD_COMPONENT_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'external-load-component-page.ts'
);
const ROUTE_GUARD_REDIRECT_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'route-guard-redirect-page.ts'
);
const MATERIAL_SSR_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'material-ssr-page.ts'
);
const CDK_LAYOUT_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'cdk-layout-page.ts'
);
const FORMS_LOCALE_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'forms-locale-page.ts'
);
const NG_OPTIMIZED_IMAGE_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'ng-optimized-image-page.ts'
);
const HTTP_INTERCEPTOR_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'http-interceptor-page.ts'
);
const LOAD_CHILDREN_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'load-children-page.ts'
);
const DOCUMENT_TITLE_META_FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'angular',
	'document-title-meta-page.ts'
);
const nativeFetch = globalThis.fetch;
let angularSsrOutDir = '';

beforeAll(async () => {
	angularSsrOutDir = await mkdtemp(
		join(tmpdir(), 'absolutejs-angular-streaming-')
	);
	await symlink(
		resolve(import.meta.dir, '..', '..', '..', 'node_modules'),
		join(angularSsrOutDir, 'node_modules'),
		'dir'
	);
	process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR = angularSsrOutDir;
});

afterAll(async () => {
	delete process.env.ABSOLUTE_ANGULAR_SSR_OUTDIR;
	if (angularSsrOutDir) {
		await rm(angularSsrOutDir, { force: true, recursive: true });
	}
});

describe('handleAngularPageRequest streaming', () => {
	test('injects runtime and appends patches for registered StreamSlot components', async () => {
		const response = await handleAngularPageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Angular Streaming Test</title></head>',
			indexPath: '/angular-test-index.js',
			pagePath: FIXTURE
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('"angular-fast"');
		const slowPatchIndex = html.indexOf('"angular-slow"');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="angular-fast"');
		expect(html).toContain('id="angular-slow"');
		expect(html).toContain(
			'<script>import("/angular-test-index.js");</script>'
		);
		expect(html).toContain('angular fast resolved');
		expect(html).toContain('angular slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('injects runtime and appends patches for lowered @defer blocks', async () => {
		const response = await handleAngularPageRequest({
			collectStreamingSlots: true,
			headTag: '<head><title>Angular Defer Streaming Test</title></head>',
			indexPath: '/angular-defer-test-index.js',
			pagePath: DEFER_FIXTURE
		});
		const html = await response.text();
		const fastPatchIndex = html.indexOf('angular defer fast resolved');
		const slowPatchIndex = html.indexOf('angular defer slow resolved');

		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(html).toContain('id="absolute-angular-defer-0"');
		expect(html).toContain('id="absolute-angular-defer-1"');
		expect(html).toContain(
			'<script>import("/angular-defer-test-index.js");</script>'
		);
		expect(html).toContain('angular defer fast resolved');
		expect(html).toContain('angular defer slow resolved');
		expect(fastPatchIndex).toBeGreaterThan(-1);
		expect(slowPatchIndex).toBeGreaterThan(-1);
		expect(fastPatchIndex).toBeLessThan(slowPatchIndex);
	});

	test('provides Angular request-scoped tokens during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Request Provider Test</title></head>',
			indexPath: '/angular-request-test-index.js',
			pagePath: REQUEST_PROVIDER_FIXTURE,
			request: new Request(
				'https://absolute.test/portal/dashboard?tab=home'
			),
			requestContext: { marker: 'context-from-handler' },
			responseInit: {
				headers: { 'x-existing': 'kept' }
			}
		});
		const html = await response.text();

		expect(response.status).toBe(207);
		expect(response.headers.get('Content-Type')).toBe('text/html');
		expect(response.headers.get('x-existing')).toBe('kept');
		expect(response.headers.get('x-angular-ssr')).toBe('request-token');
		expect(html).toContain(
			'<p id="request-url">https://absolute.test/portal/dashboard?tab=home</p>'
		);
		expect(html).toContain(
			'<p id="request-context">context-from-handler</p>'
		);
	});

	test('uses noop animation providers for legacy Angular animations during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Legacy Animation Test</title></head>',
			indexPath: '/angular-legacy-animation-test-index.js',
			pagePath: LEGACY_ANIMATION_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="animation-module-type"');
		expect(html).toContain('NoopAnimations');
		expect(html).toContain('legacy animation content');
	});

	test('waits for async Angular route resolvers before serializing SSR HTML', async () => {
		const response = await handleAngularPageRequest({
			headTag: '<head><title>Angular Async Resolver Test</title></head>',
			indexPath: '/angular-async-resolver-test-index.js',
			pagePath: ASYNC_ROUTE_RESOLVER_FIXTURE,
			request: new Request('https://absolute.test/resolver')
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="resolved-value"');
		expect(html).toContain('42');
	});

	test('provides deterministic Angular render values for SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Deterministic Env Test</title></head>',
			indexPath: '/angular-deterministic-env-test-index.js',
			pagePath: DETERMINISTIC_ENV_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('<p id="deterministic-now">1777464000000</p>');
		expect(html).toContain('id="deterministic-values"');
		expect(html).toContain('0.');
	});

	test('uses page module providers as the canonical Angular provider model', async () => {
		const response = await handleAngularPageRequest({
			headTag: '<head><title>Angular Provider Model Test</title></head>',
			indexPath: '/angular-provider-model-test-index.js',
			pagePath: PROVIDER_MODEL_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain(
			'<p id="provider-model-value">page-module-provider</p>'
		);
	});

	test('honors Angular route-level providers during SSR', async () => {
		const adminResponse = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Route Provider Admin Test</title></head>',
			indexPath: '/angular-route-provider-test-index.js',
			pagePath: ROUTE_PROVIDER_FIXTURE,
			request: new Request('https://absolute.test/admin')
		});
		const settingsResponse = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Route Provider Settings Test</title></head>',
			indexPath: '/angular-route-provider-test-index.js',
			pagePath: ROUTE_PROVIDER_FIXTURE,
			request: new Request('https://absolute.test/settings')
		});
		const adminHtml = await adminResponse.text();
		const settingsHtml = await settingsResponse.text();

		expect(adminResponse.status).toBe(200);
		expect(settingsResponse.status).toBe(200);
		expect(adminHtml).toContain(
			'<p id="route-provider-value">admin-route-provider</p>'
		);
		expect(settingsHtml).toContain(
			'<p id="route-provider-value">settings-route-provider</p>'
		);
	});

	test('renders lazy Angular route components imported from external packages', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular External Lazy Component Test</title></head>',
			indexPath: '/angular-external-lazy-component-test-index.js',
			pagePath: EXTERNAL_LOAD_COMPONENT_FIXTURE,
			request: new Request('https://absolute.test/external-lazy')
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain(
			'<p id="external-lazy-component">external package lazy route</p>'
		);
	});

	test('turns Angular route guard redirects into HTTP redirects during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Route Guard Redirect Test</title></head>',
			indexPath: '/angular-route-guard-redirect-test-index.js',
			pagePath: ROUTE_GUARD_REDIRECT_FIXTURE,
			request: new Request('https://absolute.test/protected')
		});
		const html = await response.text();

		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe('/login?from=protected');
		expect(html).toContain('<p id="login-route">login</p>');
	});

	test('renders Angular Material components and dialog overlay during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag: '<head><title>Angular Material SSR Test</title></head>',
			indexPath: '/angular-material-ssr-test-index.js',
			pagePath: MATERIAL_SSR_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="material-card-content"');
		expect(html).toContain('material card content');
		expect(html).toContain('<p id="material-dialog-state">opened</p>');
		expect(html).toContain('id="material-dialog-content"');
		expect(html).toContain('material dialog content');
	});

	test('renders Angular CDK layout observers during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag: '<head><title>Angular CDK Layout SSR Test</title></head>',
			indexPath: '/angular-cdk-layout-ssr-test-index.js',
			pagePath: CDK_LAYOUT_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('id="cdk-layout-matched"');
		expect(html).toContain('breakpoint observer ready');
	});

	test('renders Angular forms and locale-aware common pipes during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Forms Locale SSR Test</title></head>',
			indexPath: '/angular-forms-locale-ssr-test-index.js',
			pagePath: FORMS_LOCALE_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('<p id="forms-name">Ada</p>');
		expect(html).toContain('<p id="forms-valid">true</p>');
		expect(html).toContain('<p id="locale-id">fr-FR</p>');
		expect(html).toContain('id="locale-date"');
		expect(html).toContain('2024');
		expect(html).toContain('id="locale-currency"');
		expect(html).toContain('EUR');
	});

	test('renders Angular NgOptimizedImage during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Optimized Image SSR Test</title></head>',
			indexPath: '/angular-optimized-image-ssr-test-index.js',
			pagePath: NG_OPTIMIZED_IMAGE_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('ng-img');
		expect(html).toContain('src="/assets/angular-optimized.png"');
		expect(html).toContain(
			'<p id="optimized-image-ready">optimized image ready</p>'
		);
	});

	test('runs Angular HttpClient interceptors during SSR', async () => {
		const fetchMock = mock(
			(input: RequestInfo | URL, init?: RequestInit) => {
				const headers =
					input instanceof Request
						? input.headers
						: new Headers(init?.headers);

				return Promise.resolve(
					new Response(
						JSON.stringify({
							cookie: headers.get('x-absolute-cookie'),
							marker: headers.get('x-absolute-interceptor')
						}),
						{
							headers: { 'Content-Type': 'application/json' }
						}
					)
				);
			}
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const response = await handleAngularPageRequest({
				headTag:
					'<head><title>Angular Http Interceptor SSR Test</title></head>',
				indexPath: '/angular-http-interceptor-ssr-test-index.js',
				pagePath: HTTP_INTERCEPTOR_FIXTURE,
				request: new Request('https://absolute.test/interceptor', {
					headers: { cookie: 'session=abc' }
				})
			});
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(html).toContain(
				'<p id="http-interceptor-cookie">session=abc</p>'
			);
			expect(html).toContain('<p id="http-interceptor-marker">hit</p>');
		} finally {
			globalThis.fetch = nativeFetch;
		}
	});

	test('renders lazy Angular route children during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Angular Load Children SSR Test</title></head>',
			indexPath: '/angular-load-children-ssr-test-index.js',
			pagePath: LOAD_CHILDREN_FIXTURE,
			request: new Request('https://absolute.test/lazy-children')
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain(
			'<p id="lazy-children-route">lazy children route rendered</p>'
		);
	});

	test('renders Angular DOCUMENT, Title, and Meta services during SSR', async () => {
		const response = await handleAngularPageRequest({
			headTag:
				'<head><title>Initial Angular Document Test</title></head>',
			indexPath: '/angular-document-title-meta-ssr-test-index.js',
			pagePath: DOCUMENT_TITLE_META_FIXTURE
		});
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(html).toContain('<title>Angular document title</title>');
		expect(html).toContain('name="description"');
		expect(html).toContain('content="Angular SSR meta description"');
		expect(html).toContain('<p id="document-body-tag">body</p>');
		expect(html).toContain(
			'<p id="document-title-value">Angular document title</p>'
		);
	});
});
