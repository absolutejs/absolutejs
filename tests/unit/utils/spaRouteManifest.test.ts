import { beforeEach, describe, expect, test } from 'bun:test';
import {
	isKnownSpaRoute,
	renderSpaNotFoundResponse,
	setSpaRouteManifest,
	type RuntimeSpaHost
} from '../../../src/utils/spaRouteManifest';

const host = (
	framework: RuntimeSpaHost['framework'],
	sourceFile: string,
	baseHref: string,
	paths: string[]
): RuntimeSpaHost => ({
	baseHref,
	framework,
	routes: paths.map((path) => ({
		dynamic: path.includes(':') || path.includes('*'),
		path,
		redirected: false,
		sitemapExcluded: false
	})),
	sourceFile
});

describe('SPA route manifest', () => {
	beforeEach(() => setSpaRouteManifest([]));

	test('matches static, dynamic, optional, and wildcard routes', () => {
		setSpaRouteManifest([
			host('vue', '/app/Portal.vue', '/portal/', [
				'/portal/dashboard',
				'/portal/matches/:id',
				'/portal/search/:term?',
				'/portal/files/**'
			])
		]);

		for (const path of [
			'/portal/dashboard',
			'/portal/matches/42',
			'/portal/search',
			'/portal/search/query',
			'/portal/files',
			'/portal/files/a/b'
		]) {
			expect(
				isKnownSpaRoute(
					'vue',
					'Portal',
					new Request(`https://x.test${path}`)
				)
			).toBe(true);
		}
		expect(
			isKnownSpaRoute(
				'vue',
				'Portal',
				new Request('https://x.test/portal/missing')
			)
		).toBe(false);
	});

	test('only applies a manifest to its framework and page', () => {
		setSpaRouteManifest([
			host('react', '/app/App.tsx', '/', ['/dashboard'])
		]);
		const request = new Request('https://x.test/unrelated');

		expect(isKnownSpaRoute('react', 'App', request)).toBe(false);
		expect(isKnownSpaRoute('react', 'Marketing', request)).toBe(true);
		expect(isKnownSpaRoute('svelte', 'App', request)).toBe(true);
	});
});

describe('renderSpaNotFoundResponse', () => {
	test('a JSON client gets a JSON 404, a page request the HTML one', async () => {
		const json = await renderSpaNotFoundResponse(
			new Request('https://example.com/app/missing', {
				headers: { accept: 'application/json' }
			})
		);
		expect(json.status).toBe(404);
		expect(json.headers.get('content-type')).toContain('json');
		expect(await json.json()).toMatchObject({ status: 404 });

		const page = await renderSpaNotFoundResponse(
			new Request('https://example.com/app/missing', {
				headers: { accept: 'text/html' }
			})
		);
		expect(page.status).toBe(404);
		expect(page.headers.get('content-type')).not.toContain('json');
	});
});
