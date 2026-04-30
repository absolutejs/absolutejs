import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_HTTP_TRANSFER_CACHE_SKIP_HEADER,
	buildAbsoluteHttpTransferCacheOptions
} from '../../../src/angular/httpTransferCache';

const buildRequest = (headers: Record<string, string>) => ({
	headers: {
		has: (headerName: string) => headerName in headers
	}
});

describe('Angular HTTP transfer cache options', () => {
	test('skips requests with the AbsoluteJS transfer-cache header', () => {
		const options = buildAbsoluteHttpTransferCacheOptions();

		expect(
			options.filter?.(
				buildRequest({
					[ABSOLUTE_HTTP_TRANSFER_CACHE_SKIP_HEADER]: '1'
				}) as never
			)
		).toBe(false);
		expect(options.filter?.(buildRequest({}) as never)).toBe(true);
	});

	test('preserves Angular transfer-cache options and user filters', () => {
		const options = buildAbsoluteHttpTransferCacheOptions({
			includePostRequests: true,
			skipHeader: 'x-no-transfer',
			filter: (request) => request.headers.has('x-cacheable')
		});

		expect(options.includePostRequests).toBe(true);
		expect(
			options.filter?.(
				buildRequest({
					'x-cacheable': '1'
				}) as never
			)
		).toBe(true);
		expect(
			options.filter?.(
				buildRequest({
					'x-cacheable': '1',
					'x-no-transfer': '1'
				}) as never
			)
		).toBe(false);
	});
});
