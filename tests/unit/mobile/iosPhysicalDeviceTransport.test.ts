import { afterEach, describe, expect, test } from 'bun:test';
import { connect, createServer, type Server } from 'node:net';
import { findFreePort } from '../../../src/cli/utils';
import {
	normalizeAbsoluteIosDeviceHost,
	normalizeAbsoluteIosDeviceIdentifier,
	startAbsoluteIosTcpRelay,
	type AbsoluteIosCloseableServer
} from '../../../src/mobile/iosPhysicalDeviceTransport';

const servers: Array<AbsoluteIosCloseableServer | Server> = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					if ('listening' in server) server.close(() => resolve());
					else void server.close().then(resolve, resolve);
				})
		)
	);
});

describe('physical iOS development transport', () => {
	test('validates device selectors and LAN hosts before commands are built', () => {
		expect(normalizeAbsoluteIosDeviceIdentifier('  My iPhone  ')).toBe(
			'My iPhone'
		);
		expect(normalizeAbsoluteIosDeviceHost('192.168.1.8')).toBe(
			'192.168.1.8'
		);
		expect(() =>
			normalizeAbsoluteIosDeviceIdentifier('bad\nvalue')
		).toThrow('valid Xcode device');
		expect(() => normalizeAbsoluteIosDeviceHost('https://host')).toThrow(
			'valid LAN host'
		);
	});

	test('relays raw device traffic to the loopback SSH tunnel', async () => {
		const upstream = createServer((socket) => {
			socket.on('data', (data) =>
				socket.write(data.toString().toUpperCase())
			);
		});
		servers.push(upstream);
		await new Promise<void>((resolve) =>
			upstream.listen(0, '127.0.0.1', resolve)
		);
		const address = upstream.address();
		if (!address || typeof address === 'string')
			throw new Error('Test upstream did not bind.');
		const relayPort = await findFreePort();
		const relay = await startAbsoluteIosTcpRelay({
			listenPort: relayPort,
			targetPort: address.port
		});
		servers.push(relay);
		const response = await new Promise<string>((resolve, reject) => {
			const client = connect(relayPort, '127.0.0.1');
			client.once('error', reject);
			client.once('connect', () => client.write('absolute'));
			client.once('data', (data) => {
				resolve(data.toString());
				client.end();
			});
		});
		expect(response).toBe('ABSOLUTE');
	});
});
