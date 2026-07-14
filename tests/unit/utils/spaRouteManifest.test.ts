import { beforeEach, describe, expect, test } from 'bun:test';
import {
	isKnownSpaRoute,
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
