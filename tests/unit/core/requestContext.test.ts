import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
	absoluteRequestContext,
	getCurrentAbsoluteRequest,
	runWithAbsoluteRequest
} from '../../../src/core/requestContext';

describe('Absolute request context', () => {
	test('keeps concurrent request chains isolated', async () => {
		const first = new Request('https://example.test/first');
		const second = new Request('https://example.test/second');
		const [firstUrl, secondUrl] = await Promise.all([
			runWithAbsoluteRequest(first, async () => {
				await Bun.sleep(2);

				return getCurrentAbsoluteRequest()?.url;
			}),
			runWithAbsoluteRequest(second, async () => {
				await Bun.sleep(1);

				return getCurrentAbsoluteRequest()?.url;
			})
		]);

		expect(firstUrl).toBe(first.url);
		expect(secondUrl).toBe(second.url);
		expect(getCurrentAbsoluteRequest()).toBeUndefined();
	});

	test('propagates through routes registered after the Absolute plugin', async () => {
		const app = new Elysia()
			.use(absoluteRequestContext)
			.get(
				'/context',
				() => getCurrentAbsoluteRequest()?.url ?? 'missing'
			);
		const request = new Request('https://example.test/context');
		const response = await app.handle(request);

		expect(await response.text()).toBe(request.url);
	});
});
