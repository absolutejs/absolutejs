import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createAbsoluteHttpClient } from '@absolutejs/http';
import { installAbsoluteMobileShellHttp } from '../../../src/mobile/shellHttp';

let remove: (() => void) | undefined;

afterEach(() => {
	remove?.();
	remove = undefined;
});

describe('mobile shell HTTP runtime', () => {
	test('routes ordinary page requests through the installed native Auth fetch', async () => {
		const fetch = mock(async (input: RequestInfo | URL) => {
			const request =
				input instanceof Request ? input : new Request(input);
			const headers = new Headers(request.headers);
			headers.set('authorization', 'Bearer provider-owned');
			expect(request.url).toBe('https://app.example/api/profile');
			expect(request.headers.has('authorization')).toBe(false);

			return Response.json({
				authenticated: headers.has('authorization')
			});
		});
		remove = installAbsoluteMobileShellHttp('https://app.example', fetch);

		const client = createAbsoluteHttpClient();
		expect(
			await client.get<{ authenticated: boolean }>('/api/profile')
		).toEqual({ authenticated: true });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test('rejects a cross-origin URL before invoking the native provider', async () => {
		const fetch = mock(async () => Response.json({}));
		remove = installAbsoluteMobileShellHttp('https://app.example', fetch);

		await expect(
			createAbsoluteHttpClient().get('https://attacker.invalid/steal')
		).rejects.toMatchObject({ code: 'origin' });
		expect(fetch).not.toHaveBeenCalled();
	});
});
