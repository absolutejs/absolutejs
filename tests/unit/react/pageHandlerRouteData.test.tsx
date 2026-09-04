import { describe, expect, test } from 'bun:test';
import { ABSOLUTE_ROUTE_DATA_MEDIA_TYPE } from '../../../src/mobile/pageProtocol';
import { runWithAbsoluteRequest } from '../../../src/core/requestContext';
import { handleReactPageRequest } from '../../../src/react';

const routeRequest = () =>
	new Request('https://example.test/account/42?tab=billing', {
		headers: { accept: ABSOLUTE_ROUTE_DATA_MEDIA_TYPE }
	});

describe('handleReactPageRequest route data', () => {
	test('answers with props + the client entry without rendering', async () => {
		let rendered = false;
		const Account = () => {
			rendered = true;

			throw new Error('Route data must not SSR the page.');
		};
		Account.displayName = 'Account';
		const response = await handleReactPageRequest({
			index: '/react/indexes/Account-abc.js',
			Page: Account,
			props: { displayName: 'Ada' },
			request: routeRequest()
		});

		expect(rendered).toBe(false);
		expect(response.headers.get('content-type')).toContain(
			ABSOLUTE_ROUTE_DATA_MEDIA_TYPE
		);
		expect(response.headers.get('etag')).toBeTruthy();
		expect(await response.json()).toEqual({
			assets: { css: [], index: '/react/indexes/Account-abc.js' },
			framework: 'react',
			kind: 'route',
			pageId: 'Account',
			props: { displayName: 'Ada', url: '/account/42?tab=billing' },
			protocol: 1,
			status: 200
		});
	});

	test('reads the request off the Elysia context like the page path does', async () => {
		const Account = (_props: { displayName: string }) => null;
		const response = await runWithAbsoluteRequest(routeRequest(), () =>
			handleReactPageRequest({
				index: '/react/indexes/Account-abc.js',
				Page: Account,
				props: { displayName: 'Ada' }
			})
		);

		expect(await response.json()).toMatchObject({
			kind: 'route',
			pageId: 'Account'
		});
	});
});
