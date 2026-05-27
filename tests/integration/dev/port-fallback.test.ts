import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { resolveDevPort } from '../../../src/utils/resolveDevPort';
import { getAvailablePort } from '../../helpers/ports';

const openServers = new Set<Server>();

const occupyPort = (port: number) =>
	new Promise<Server>((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(port, 'localhost', () => {
			openServers.add(server);
			resolve(server);
		});
	});

afterEach(async () => {
	await Promise.all(
		[...openServers].map(
			(server) =>
				new Promise<void>((resolve) => {
					openServers.delete(server);
					server.close(() => resolve());
				})
		)
	);
});

describe('resolveDevPort — Vite-style port fallback', () => {
	test('falls through to the next free port when the requested one is busy', async () => {
		const baseport = await getAvailablePort();
		// Hold `baseport` so resolveDevPort sees it as in-use.
		await occupyPort(baseport);

		const result = await resolveDevPort(baseport, {
			portRange: 10,
			strictPort: false
		});

		expect(result.fellBack).toBe(true);
		expect(result.port).toBeGreaterThan(baseport);
		expect(result.port).toBeLessThan(baseport + 10);
	});

	test('returns the requested port when it is free', async () => {
		const port = await getAvailablePort();
		const result = await resolveDevPort(port, {
			portRange: 10,
			strictPort: false
		});

		expect(result.fellBack).toBe(false);
		expect(result.port).toBe(port);
	});

	test('strictPort: true throws clearly when the requested port is busy', async () => {
		const port = await getAvailablePort();
		await occupyPort(port);

		await expect(
			resolveDevPort(port, { portRange: 10, strictPort: true })
		).rejects.toThrow(
			`Port ${port} is in use, try another port or set strictPort: false`
		);
	});

	test('throws when no free port exists within the range', async () => {
		const start = await getAvailablePort();
		// Occupy a small contiguous block.
		const range = 3;
		for (let offset = 0; offset < range; offset += 1) {
			await occupyPort(start + offset);
		}

		await expect(
			resolveDevPort(start, { portRange: range, strictPort: false })
		).rejects.toThrow('Could not find a free port');
	});
});
