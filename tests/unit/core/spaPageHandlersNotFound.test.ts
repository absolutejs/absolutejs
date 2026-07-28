import { afterEach, describe, expect, test } from 'bun:test';
import { handleAngularPageRequest } from '../../../src/angular/pageHandler';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import {
	setSpaRouteManifest,
	type RuntimeSpaHost
} from '../../../src/utils/spaRouteManifest';

const frameworks = ['angular', 'react', 'svelte', 'vue'] as const;
const sourceExtension = (framework: (typeof frameworks)[number]) => {
	if (framework === 'react') return 'tsx';
	if (framework === 'svelte' || framework === 'vue') return framework;

	return 'ts';
};

const hosts: RuntimeSpaHost[] = frameworks.map((framework) => ({
	baseHref: '/portal/',
	framework,
	routes: [
		{
			dynamic: false,
			path: '/portal/dashboard',
			redirected: false,
			sitemapExcluded: false
		}
	],
	sourceFile: `/app/Portal.${sourceExtension(framework)}`
}));

describe('SPA page handlers', () => {
	afterEach(() => setSpaRouteManifest([]));

	test('return HTTP 404 before rendering an unmatched SPA shell', async () => {
		setSpaRouteManifest(hosts);
		const request = new Request('https://example.com/portal/missing');
		const Portal = () => null;

		const responses = await Promise.all([
			handleAngularPageRequest({
				indexPath: '/PortalIndex.js',
				pagePath: '/tmp/Portal.js',
				request
			}),
			handleReactPageRequest({
				index: '/PortalIndex.js',
				Page: Portal,
				request
			}),
			handleSveltePageRequest({
				indexPath: '/PortalIndex.js',
				pagePath: '/tmp/Portal.js',
				request
			}),
			handleVuePageRequest({
				client: 'none',
				pagePath: '/tmp/Portal.js',
				props: {},
				request
			})
		]);

		expect(responses.map((response) => response.status)).toEqual([
			404, 404, 404, 404
		]);
	});
});
