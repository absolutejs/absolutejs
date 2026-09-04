import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	ABSOLUTE_ROUTE_DATA_MEDIA_TYPE,
	ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION,
	finalizeAbsoluteMobilePage,
	MOBILE_PAGE_REQUEST_HEADERS,
	type AbsoluteMobilePageCompatibility,
	type AbsoluteRouteDataInput
} from '../../../src/mobile/pageProtocol';

type AccountProps = { displayName: string };

const compatibility: AbsoluteMobilePageCompatibility<AccountProps> = {
	framework: 'vue',
	pageId: 'Account',
	representations: [{ contract: 'account@1', mapProps: (props) => props }],
	runtimes: ['1']
};

const routeRequest = (init: RequestInit = {}) =>
	new Request('https://example.test/account/42', {
		headers: { accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE },
		...init
	});

const route: AbsoluteRouteDataInput = {
	assets: {
		client: '/vue/client/Account-def.js',
		css: ['/css/Account-abc.css', '/css/Account-abc.css', ''],
		index: '/vue/indexes/Account-abc.js'
	},
	head: { title: 'Account' }
};

const finalize = (request: Request | undefined, status?: number) =>
	finalizeAbsoluteMobilePage({
		compatibility,
		props: { displayName: 'Ada' },
		request,
		route,
		...(status === undefined ? {} : { status })
	});

describe('web route data', () => {
	test('serves the route envelope for the route-data Accept header', async () => {
		const response = finalize(routeRequest());
		if (!response) throw new Error('expected a route-data response');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe(
			`${ABSOLUTE_ROUTE_DATA_MEDIA_TYPE}; version=${ABSOLUTE_ROUTE_DATA_PROTOCOL_VERSION}`
		);
		expect(response.headers.get('vary')).toBe('Accept');
		expect(await response.json()).toEqual({
			assets: {
				client: '/vue/client/Account-def.js',
				// Deduped, and empty hrefs dropped.
				css: ['/css/Account-abc.css'],
				index: '/vue/indexes/Account-abc.js'
			},
			framework: 'vue',
			head: { title: 'Account' },
			kind: 'route',
			pageId: 'Account',
			props: { displayName: 'Ada' },
			protocol: 1,
			status: 200
		});
	});

	test('is cacheable and revalidates a prefetched copy with a 304', async () => {
		const first = finalize(routeRequest());
		if (!first) throw new Error('expected a route-data response');
		const etag = first.headers.get('etag');

		expect(first.headers.get('cache-control')).toBe(
			'private, max-age=0, must-revalidate'
		);
		expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);

		const revalidated = finalize(
			routeRequest({
				headers: {
					accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE,
					'if-none-match': etag ?? ''
				}
			})
		);
		if (!revalidated) throw new Error('expected a route-data response');
		expect(revalidated.status).toBe(304);
		expect(revalidated.headers.get('etag')).toBe(etag);
		expect(await revalidated.text()).toBe('');
	});

	test('a different body produces a different ETag', () => {
		const first = finalize(routeRequest());
		const second = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Grace' },
			request: routeRequest(),
			route
		});

		expect(first?.headers.get('etag')).not.toBe(
			second?.headers.get('etag')
		);
	});

	test('carries the handler status through', async () => {
		const response = finalize(routeRequest(), 404);
		if (!response) throw new Error('expected a route-data response');

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ status: 404 });
	});

	test('is GET only', () => {
		const response = finalize(routeRequest({ method: 'POST' }));

		expect(response?.status).toBe(405);
		expect(response?.headers.get('allow')).toBe('GET');
	});

	test('needs no client identity headers and no development mode', () => {
		const previous = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		try {
			expect(finalize(routeRequest())?.status).toBe(200);
		} finally {
			if (previous === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previous;
		}
	});

	test('leaves ordinary browser requests to the page renderer', () => {
		expect(
			finalize(
				new Request('https://example.test/account/42', {
					headers: { accept: 'text/html,*/*;q=0.8' }
				})
			)
		).toBeUndefined();
		expect(finalize(undefined)).toBeUndefined();
	});

	test('does not disturb the mobile page media type', async () => {
		const response = finalize(
			new Request('https://example.test/account/42', {
				headers: {
					accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
					[MOBILE_PAGE_REQUEST_HEADERS.appBuild]: '42',
					[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: 'account-bundle',
					[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: 'account@1',
					[MOBILE_PAGE_REQUEST_HEADERS.pageId]: 'Account',
					[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
					[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
				}
			})
		);
		if (!response) throw new Error('expected a mobile response');

		expect(response.headers.get('content-type')).toContain(
			ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({
			protocol: 1,
			response: { contract: 'account@1', kind: 'page' }
		});
	});

	test('reports a representation failure as a route error envelope', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility: {
				framework: 'react',
				pageId: 'Broken',
				representations: [
					{
						contract: 'broken@1',
						mapProps: () => {
							throw new Error('boom');
						}
					}
				],
				runtimes: ['1']
			},
			props: {},
			request: routeRequest()
		});
		if (!response) throw new Error('expected a route-data response');

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			code: 'representation-failed',
			kind: 'error',
			pageId: 'Broken',
			protocol: 1,
			status: 500
		});
	});

	test('defaults assets to an empty stylesheet list', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: routeRequest()
		});
		if (!response) throw new Error('expected a route-data response');

		expect(await response.json()).toMatchObject({ assets: { css: [] } });
	});
});
