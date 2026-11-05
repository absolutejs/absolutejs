import { expect, test } from 'bun:test';
import {
	startTunnelRelay,
	parseTunnelPublicRoutes
} from '../../../src/dev/tunnel/relay';
import { TUNNEL_CONTROL_PATH } from '../../../src/dev/tunnel/protocol';

test('callback relay denies other routes and public WebSockets before forwarding', async () => {
	const relay = startTunnelRelay({
		healthPath: '/healthz',
		port: 0,
		publicRoutes: [{ method: 'POST', path: '/api/calendar/notify' }],
		token: 'synthetic-secret'
	});
	const base = `http://localhost:${relay.port}`;
	let socket: WebSocket | undefined;
	const forwarded: string[] = [];
	try {
		expect((await fetch(`${base}/healthz`)).status).toBe(204);
		expect(
			(await fetch(`${base}/healthz`, { method: 'POST' })).status
		).toBe(404);
		expect((await fetch(`${base}/`)).status).toBe(404);
		expect(
			(await fetch(`${base}/api/calendar/notify`, { method: 'POST' }))
				.status
		).toBe(503);
		expect(
			(await fetch(`${base + TUNNEL_CONTROL_PATH}?token=wrong`)).status
		).toBe(403);
		socket = new WebSocket(
			`${
				base.replace('http:', 'ws:') + TUNNEL_CONTROL_PATH
			}?token=synthetic-secret`
		);
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (message.type === 'request') {
				forwarded.push(message.url);
				socket?.send(
					JSON.stringify({
						headers: {},
						id: message.id,
						status: 204,
						type: 'response'
					})
				);
			}
		});
		await new Promise<void>((resolve, reject) => {
			socket?.addEventListener('open', () => resolve(), { once: true });
			socket?.addEventListener(
				'error',
				() => reject(new Error('Control connection failed')),
				{ once: true }
			);
		});
		expect(
			(
				await fetch(`${base}/api/calendar/notify?watch=abc`, {
					headers: { 'x-goog-channel-id': 'example' },
					method: 'POST'
				})
			).status
		).toBe(204);
		expect((await fetch(`${base}/api/calendar/notify`)).status).toBe(404);
		expect(
			(
				await fetch(`${base}/api/calendar/notify/extra`, {
					method: 'POST'
				})
			).status
		).toBe(404);
		expect(
			(
				await fetch(`${base}/api/calendar/notify`, {
					headers: { upgrade: 'websocket' },
					method: 'POST'
				})
			).status
		).toBe(404);
		expect((await fetch(`${base}/sync/ws`)).status).toBe(404);
		expect(forwarded).toEqual(['/api/calendar/notify?watch=abc']);
	} finally {
		socket?.close();
		relay.stop(true);
	}
});

test('invalid relay restrictions fail closed and an empty list denies every public request', async () => {
	for (const value of [
		'null',
		'{}',
		'[{"path":"/../private","method":"POST"}]',
		'[{"path":"/callback?x=1","method":"POST"}]',
		'[{"path":"//external","method":"POST"}]',
		'[{"path":"/callback","method":"post"}]',
		JSON.stringify([{ method: 'GET', path: TUNNEL_CONTROL_PATH }])
	])
		expect(() => parseTunnelPublicRoutes(value)).toThrow();
	const relay = startTunnelRelay({
		port: 0,
		publicRoutes: [],
		token: 'synthetic-secret'
	});
	try {
		expect((await fetch(`http://localhost:${relay.port}/`)).status).toBe(
			404
		);
	} finally {
		relay.stop(true);
	}
});
