import { describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { devPort, portCheck } from '../../../src/cli/scripts/doctor';
import { DEFAULT_PORT } from '../../../src/constants';
import { isPortInUse } from '../../../src/utils/portInUse';

const listen = (host: string, ipv6Only = false, port = 0) =>
	new Promise<Server>((resolve, reject) => {
		const server = createServer((socket) => socket.destroy());
		server.once('error', reject);
		server.listen({ host, ipv6Only, port }, () => resolve(server));
	});

const portOf = (server: Server) => {
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('listener has no port');
	}

	return address.port;
};

const close = (server: Server) =>
	new Promise<void>((resolve) => {
		server.close(() => resolve());
	});

const hasIpv6Loopback = await listen('::1', true).then(
	async (server) => {
		await close(server);

		return true;
	},
	() => false
);

const freePort = async () => {
	const server = await listen('127.0.0.1');
	const port = portOf(server);
	await close(server);

	return port;
};

type ListenerCase = { host: string; ipv6Only: boolean; name: string };

const LISTENERS: ListenerCase[] = [
	{ host: '127.0.0.1', ipv6Only: false, name: 'IPv4 loopback only' },
	{ host: '0.0.0.0', ipv6Only: false, name: 'IPv4 wildcard only' },
	{ host: '::1', ipv6Only: true, name: 'IPv6 loopback only' },
	{ host: '::', ipv6Only: true, name: 'IPv6 wildcard only' },
	{ host: '::', ipv6Only: false, name: 'dual-stack' }
];

describe('isPortInUse', () => {
	for (const { host, ipv6Only, name } of LISTENERS) {
		const needsIpv6 = host.includes(':');
		test.skipIf(needsIpv6 && !hasIpv6Loopback)(
			`reports a ${name} listener as in use`,
			async () => {
				const server = await listen(host, ipv6Only);
				const port = portOf(server);
				try {
					expect(await isPortInUse(port)).toBe(true);
				} finally {
					await close(server);
				}
			}
		);
	}

	test('reports a Bun.serve listener as in use', async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response() });
		try {
			expect(await isPortInUse(server.port ?? 0)).toBe(true);
		} finally {
			await server.stop(true);
		}
	});

	test('reports a port with nothing listening as free', async () => {
		expect(await isPortInUse(await freePort())).toBe(false);
	});

	test('releases its probe sockets before returning', async () => {
		const port = await freePort();
		expect(await isPortInUse(port)).toBe(false);
		await close(await listen('0.0.0.0', false, port));
		if (hasIpv6Loopback) await close(await listen('::', true, port));
	});
});

describe('doctor port check', () => {
	test('resolves ABSOLUTE_PORT, then PORT, then dev.port, then the default', () => {
		const config: { dev: { port: number } } = { dev: { port: 4100 } };
		expect(devPort(config, { ABSOLUTE_PORT: '4300', PORT: '4200' })).toBe(
			4300
		);
		expect(devPort(config, { PORT: '4200' })).toBe(4200);
		expect(devPort(config, {})).toBe(4100);
		expect(devPort({}, {})).toBe(DEFAULT_PORT);
		expect(devPort(null, { PORT: '4200' })).toBe(4200);
	});

	for (const { host, ipv6Only, name } of LISTENERS) {
		const needsIpv6 = host.includes(':');
		test.skipIf(needsIpv6 && !hasIpv6Loopback)(
			`warns when PORT is held by a ${name} listener`,
			async () => {
				const server = await listen(host, ipv6Only);
				const port = portOf(server);
				try {
					const result = await portCheck({}, { PORT: String(port) });
					expect(result.status).toBe('warn');
					expect(result.detail).toStartWith(`${port} in use`);
				} finally {
					await close(server);
				}
			}
		);
	}

	test('warns when the configured dev.port is held', async () => {
		const server = await listen('127.0.0.1');
		const port = portOf(server);
		try {
			const result = await portCheck({ dev: { port } }, {});
			expect(result.status).toBe('warn');
		} finally {
			await close(server);
		}
	});

	test('reports a free port as free', async () => {
		const port = await freePort();
		const result = await portCheck({}, { PORT: String(port) });
		expect(result).toEqual({
			detail: `${port} free`,
			label: 'Dev port',
			status: 'ok'
		});
	});
});
