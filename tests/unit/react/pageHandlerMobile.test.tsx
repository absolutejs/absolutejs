import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	MOBILE_PAGE_REQUEST_HEADERS
} from '../../../src/mobile/pageProtocol';
import { runWithAbsoluteRequest } from '../../../src/core/requestContext';
import { handleReactPageRequest } from '../../../src/react';

const requestFor = (contracts: string) =>
	new Request('https://example.test/account/42?tab=billing', {
		headers: {
			accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
			[MOBILE_PAGE_REQUEST_HEADERS.appBuild]: '42',
			[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: 'account-bundle-n',
			[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: contracts,
			[MOBILE_PAGE_REQUEST_HEADERS.pageId]: 'Account',
			[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
			[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
		}
	});

describe('handleReactPageRequest mobile representation', () => {
	test('returns props without executing server rendering', async () => {
		let rendered = false;
		const Account = () => {
			rendered = true;

			throw new Error('The mobile data representation must not SSR.');
		};
		Account.displayName = 'Account';
		const response = await handleReactPageRequest({
			index: '/react/account.js',
			Page: Account,
			props: { displayName: 'Ada' },
			request: requestFor('react:Account:1')
		});
		const envelope = await response.json();

		expect(rendered).toBe(false);
		expect(response.headers.get('content-type')).toContain(
			ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE
		);
		expect(envelope.response).toMatchObject({
			contract: 'react:Account:1',
			kind: 'page',
			pageId: 'Account',
			props: {
				displayName: 'Ada',
				url: '/account/42?tab=billing'
			}
		});
	});

	test('uses runtime request context without changing the route call', async () => {
		const Account = (_props: { displayName: string }) => null;
		const response = await runWithAbsoluteRequest(
			requestFor('react:Account:1'),
			() =>
				handleReactPageRequest({
					index: '/react/account.js',
					Page: Account,
					props: { displayName: 'Ada' }
				})
		);
		const envelope = await response.json();

		expect(envelope.response).toMatchObject({
			contract: 'react:Account:1',
			kind: 'page',
			pageId: 'Account',
			props: {
				displayName: 'Ada',
				url: '/account/42?tab=billing'
			}
		});
	});
});
