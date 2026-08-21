import { describe, expect, test } from 'bun:test';
import { findFreePort } from '../../../src/cli/utils';

describe('findFreePort', () => {
	test('releases the reservation before returning the assigned port', async () => {
		for (let attempt = 0; attempt < 10; attempt++) {
			const port = await findFreePort();
			const server = Bun.serve({
				hostname: '127.0.0.1',
				port,
				fetch: () => new Response()
			});

			expect(server.port).toBe(port);
			await server.stop(true);
		}
	});
});
