import { afterEach, describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	ABSOLUTE_NATIVE_ROUTE_DATA_MEDIA_TYPE,
	finalizeAbsoluteMobilePage,
	MOBILE_PAGE_REQUEST_HEADERS,
	parseAbsoluteMobilePageRequest,
	type AbsoluteMobilePageCompatibility
} from '../../../src/mobile/pageProtocol';
import { runWithAbsoluteMobileProducer } from '../../../src/mobile/producerContext';

const originalNodeEnvironment = process.env.NODE_ENV;

afterEach(() => {
	if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = originalNodeEnvironment;
});

const mobileRequest = (overrides: Record<string, string> = {}) =>
	new Request('https://example.test/account/42', {
		headers: {
			accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
			[MOBILE_PAGE_REQUEST_HEADERS.appBuild]: '42',
			[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: 'account-bundle-n',
			[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: 'account@2, account@1',
			[MOBILE_PAGE_REQUEST_HEADERS.pageId]: 'Account',
			[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
			[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '3',
			...overrides
		}
	});

type AccountProps = { displayName: string };

const compatibility: AbsoluteMobilePageCompatibility<AccountProps> = {
	framework: 'react',
	pageId: 'Account',
	representations: [
		{
			contract: 'account@3',
			mapProps: (props) => props
		},
		{
			contract: 'account@2',
			mapProps: (props) => ({
				name: props.displayName
			})
		},
		{
			contract: 'account@1',
			mapProps: (props) => ({
				label: props.displayName
			})
		}
	],
	runtimes: ['3', '2', '1']
};

describe('mobile page protocol', () => {
	test('ignores ordinary browser requests', () => {
		const request = new Request('https://example.test/account/42', {
			headers: { accept: 'text/html' }
		});

		expect(parseAbsoluteMobilePageRequest(request)).toEqual({
			kind: 'not-mobile'
		});
	});

	test('serves current typed props to native routes only in development', async () => {
		process.env.NODE_ENV = 'development';
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: new Request('https://example.test/account/42', {
				headers: {
					accept: ABSOLUTE_NATIVE_ROUTE_DATA_MEDIA_TYPE,
					[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1'
				}
			})
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(200);
		expect(envelope.response).toEqual({
			contract: 'account@3',
			framework: 'react',
			kind: 'page',
			pageId: 'Account',
			props: { displayName: 'Ada' },
			status: 200
		});
	});

	test('fails closed on the header-light native representation in production', async () => {
		process.env.NODE_ENV = 'production';
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: new Request('https://example.test/account/42', {
				headers: {
					accept: ABSOLUTE_NATIVE_ROUTE_DATA_MEDIA_TYPE,
					[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1'
				}
			})
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(400);
		expect(envelope.response).toMatchObject({ kind: 'invalid-request' });
	});

	test('selects the newest server representation understood by an older app', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: mobileRequest()
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(200);
		expect(response?.headers.get('cache-control')).toBe('no-store');
		expect(envelope.response).toEqual({
			contract: 'account@2',
			framework: 'react',
			kind: 'page',
			pageId: 'Account',
			props: { name: 'Ada' },
			status: 200
		});
	});

	test('requires an update after the app runtime leaves the retained window', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: mobileRequest({
				[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '0'
			})
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(426);
		expect(envelope.response).toEqual({
			kind: 'upgrade-required',
			pageId: 'Account',
			reason: 'runtime',
			supportedRuntimes: ['3', '2', '1']
		});
	});

	test('requires an update when no retained page contract is compatible', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: mobileRequest({
				[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: 'account@0'
			})
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(426);
		expect(envelope.response).toEqual({
			kind: 'upgrade-required',
			pageId: 'Account',
			reason: 'page-contract',
			supportedContracts: ['account@3', 'account@2', 'account@1']
		});
	});

	test('returns a typed invalid request instead of falling back to HTML', async () => {
		const request = mobileRequest();
		request.headers.delete(MOBILE_PAGE_REQUEST_HEADERS.appBuild);
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(400);
		expect(envelope.response.kind).toBe('invalid-request');
		expect(envelope.response.message).toContain(
			MOBILE_PAGE_REQUEST_HEADERS.appBuild
		);
	});

	test('rejects a page identity mismatch before negotiating props', async () => {
		const response = finalizeAbsoluteMobilePage({
			compatibility,
			props: { displayName: 'Ada' },
			request: mobileRequest({
				[MOBILE_PAGE_REQUEST_HEADERS.pageId]: 'Admin'
			})
		});
		const envelope = await response?.json();

		expect(response?.status).toBe(400);
		expect(envelope.response).toMatchObject({ kind: 'invalid-request' });
	});

	test('uses the exact contract selected for an archived producer', async () => {
		const response = runWithAbsoluteMobileProducer(
			{
				page: {
					bundleHash: 'account-bundle-n',
					bundlePath: '/pages/account-n.js',
					contract: 'account@1',
					framework: 'react',
					pageId: 'Account',
					propsSchemaHash: 'schema-1'
				},
				releaseId: 'amc_archived'
			},
			() =>
				finalizeAbsoluteMobilePage({
					compatibility,
					props: { displayName: 'Ada' },
					request: mobileRequest({
						[MOBILE_PAGE_REQUEST_HEADERS.runtime]:
							'archived-runtime'
					})
				})
		);
		const envelope = await response?.json();

		expect(response?.status).toBe(200);
		expect(envelope.response).toMatchObject({
			contract: 'account@1',
			kind: 'page',
			props: { displayName: 'Ada' }
		});
	});
});
