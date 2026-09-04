import { describe, expect, test } from 'bun:test';
import { ABSOLUTE_ROUTE_DATA_MEDIA_TYPE } from '../../../src/mobile/pageProtocol';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';

const routeRequest = () =>
	new Request('https://example.test/vue', {
		headers: { accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE }
	});

describe('handleVuePageRequest route data', () => {
	test('lists the head stylesheets and the client entry', async () => {
		const response = await handleVuePageRequest({
			headTag: generateHeadElement({
				cssPath: [
					'/css/VueExample-a.css',
					'/css/VueExampleCompiled-b.css'
				],
				title: 'AbsoluteJS + Vue'
			}),
			indexPath: '/vue/indexes/VueExample-abc.js',
			pagePath: '/vue/pages/VueExample.js',
			props: { initialCount: 0 },
			request: routeRequest()
		});

		expect(response.headers.get('content-type')).toContain(
			ABSOLUTE_ROUTE_DATA_MEDIA_TYPE
		);
		expect(await response.json()).toEqual({
			assets: {
				css: ['/css/VueExample-a.css', '/css/VueExampleCompiled-b.css'],
				index: '/vue/indexes/VueExample-abc.js'
			},
			framework: 'vue',
			head: { title: 'AbsoluteJS + Vue' },
			kind: 'route',
			pageId: 'VueExample',
			props: { initialCount: 0 },
			protocol: 1,
			status: 200
		});
	});

	test('an SSR-only page reports no client entry', async () => {
		const response = await handleVuePageRequest({
			client: 'none',
			pagePath: '/vue/pages/Docs.js',
			props: {},
			request: routeRequest()
		});
		const envelope = (await response.json()) as {
			assets: Record<string, unknown>;
			pageId: string;
		};

		expect(envelope.pageId).toBe('Docs');
		expect(envelope.assets).toEqual({ css: [] });
	});
});
