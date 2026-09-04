import { afterAll, describe, expect, test } from 'bun:test';
import { ABSOLUTE_ROUTE_DATA_MEDIA_TYPE } from '../../../src/mobile/pageProtocol';
import { startDevServer, type DevServer } from '../../helpers/devServer';

/* What a hovered `<Link>` does against the dev server, end to end.
 *
 * A hover fires two requests for the same URL: the document (with the
 * browser's `Sec-Purpose: prefetch` marker) and the route-data payload
 * (`application/vnd.absolute.route+json`). Against a lazily-built dev
 * server the first of those has to BUILD the page — once — and the real
 * navigation that follows must reuse that build. */

type LazyStatus = {
	lazyPages:
		| {
				enabled: true;
				buildCount: number;
				inFlight: string[];
				warmed: string[];
		  }
		| { enabled: false };
	manifestKeys: string[];
};

type RouteDataEnvelope = {
	assets: { client?: string; css: string[]; index?: string };
	framework: string;
	head?: { title?: string };
	kind: string;
	pageId: string;
	props: Record<string, unknown>;
	protocol: number;
	status: number;
};

let server: DevServer;

const readStatus = async () => {
	const response = await fetch(`${server.baseUrl}/hmr-status`);

	return (await response.json()) as LazyStatus;
};

const buildCount = async () => {
	const status = await readStatus();

	return status.lazyPages.enabled ? status.lazyPages.buildCount : -1;
};

/** The document request a hovered `<Link>` makes. */
const prefetchDocument = (path: string) =>
	fetch(`${server.baseUrl}${path}`, {
		headers: { Purpose: 'prefetch', 'Sec-Purpose': 'prefetch' }
	});

/** The route-data request a hovered `<Link>` makes. */
const prefetchRouteData = (path: string, ifNoneMatch?: string) =>
	fetch(`${server.baseUrl}${path}`, {
		headers: {
			Accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE,
			...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {})
		}
	});

afterAll(async () => {
	await server?.kill();
}, 20_000);

describe('dev: a hovered <Link> warms an unbuilt page', () => {
	test('the target page is not built at boot', async () => {
		server = await startDevServer();
		const status = await readStatus();

		expect(status.lazyPages.enabled).toBe(true);
		expect(status.manifestKeys).not.toContain('VueExampleIndex');
		expect(status.manifestKeys).not.toContain('ReactExampleIndex');
	}, 90_000);

	test('the hover pair builds the page once and both requests are 200', async () => {
		const before = await buildCount();

		const documentResponse = await prefetchDocument('/vue');
		expect(documentResponse.status).toBe(200);
		expect(documentResponse.headers.get('content-type')).toContain(
			'text/html'
		);

		const dataResponse = await prefetchRouteData('/vue');
		expect(dataResponse.status).toBe(200);
		expect(dataResponse.headers.get('content-type')).toContain(
			ABSOLUTE_ROUTE_DATA_MEDIA_TYPE
		);
		expect(dataResponse.headers.get('cache-control')).toBe(
			'private, max-age=0, must-revalidate'
		);
		expect(dataResponse.headers.get('etag')).toBeTruthy();

		const envelope = (await dataResponse.json()) as RouteDataEnvelope;
		expect(envelope.kind).toBe('route');
		expect(envelope.framework).toBe('vue');
		expect(envelope.pageId).toBe('VueExample');
		expect(envelope.protocol).toBe(1);
		expect(envelope.props).toMatchObject({ initialCount: 0 });
		expect(envelope.head?.title).toBe('AbsoluteJS + Vue');
		// The assets a client modulepreloads / prefetches before the click.
		expect(envelope.assets.index).toContain('_src_indexes/VueExample');
		expect(envelope.assets.css.length).toBeGreaterThan(0);
		for (const href of envelope.assets.css) {
			expect(href.startsWith('/')).toBe(true);
		}

		expect(await buildCount()).toBe(before + 1);
		const status = await readStatus();
		expect(status.manifestKeys).toContain('VueExampleIndex');
	}, 90_000);

	test('the assets the envelope names are really served', async () => {
		const envelope = (await (
			await prefetchRouteData('/vue')
		).json()) as RouteDataEnvelope;
		const hrefs = [envelope.assets.index, ...envelope.assets.css].filter(
			(href): href is string => typeof href === 'string'
		);

		for (const href of hrefs) {
			const response = await fetch(`${server.baseUrl}${href}`);
			expect(response.status).toBe(200);
		}
	}, 60_000);

	test('a prefetched copy revalidates with a 304', async () => {
		const first = await prefetchRouteData('/vue');
		const etag = first.headers.get('etag') ?? '';
		await first.text();

		const revalidated = await prefetchRouteData('/vue', etag);
		expect(revalidated.status).toBe(304);
	}, 30_000);

	test('the click that follows does not rebuild', async () => {
		const before = await buildCount();
		const navigation = await fetch(`${server.baseUrl}/vue`, {
			headers: {
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
			}
		});

		expect(navigation.status).toBe(200);
		expect(navigation.headers.get('content-type')).toContain('text/html');
		expect(await buildCount()).toBe(before);
	}, 30_000);

	test('route data alone builds a page that no document request touched', async () => {
		const before = await buildCount();
		const response = await prefetchRouteData('/react');

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as RouteDataEnvelope;
		expect(envelope.framework).toBe('react');
		expect(envelope.pageId).toBe('ReactExample');
		expect(envelope.assets.index).toContain('ReactExample');
		expect(await buildCount()).toBe(before + 1);

		const status = await readStatus();
		expect(status.manifestKeys).toContain('ReactExampleIndex');
	}, 90_000);

	test('a static page answers route data without assets', async () => {
		const response = await prefetchRouteData('/html');

		expect(response.status).toBe(200);
		const envelope = (await response.json()) as RouteDataEnvelope;
		expect(envelope.framework).toBe('html');
		expect(envelope.kind).toBe('route');
		expect(envelope.props).toEqual({});
		expect(envelope.assets.css).toEqual([]);
	}, 30_000);
});
