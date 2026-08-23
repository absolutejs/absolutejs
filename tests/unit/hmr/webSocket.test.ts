import { describe, expect, test, mock } from 'bun:test';
import {
	broadcastToClients,
	handleClientConnect,
	handleClientDisconnect,
	handleHMRMessage
} from '../../../src/dev/webSocket';
import { createHMRState } from '../../../src/dev/clientManager';
import {
	WS_READY_STATE_OPEN,
	type HMRWebSocket
} from '../../../types/websocket';

const makeConfig = () => ({ buildDirectory: '/tmp/test-build' });

const makeMockClient = (readyState = WS_READY_STATE_OPEN) =>
	({
		binaryType: 'arraybuffer',
		close: mock(() => {}),
		cork: mock(() => {}),
		data: {},
		isSubscribed: mock(() => false),
		ping: mock(() => {}),
		pong: mock(() => {}),
		publish: mock(() => {}),
		readyState,
		remoteAddress: '127.0.0.1',
		send: mock(() => {}),
		subscribe: mock(() => {}),
		unsubscribe: mock(() => {})
	}) as unknown as HMRWebSocket;

describe('handleClientConnect', () => {
	test('adds client to connected set', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		handleClientConnect(state, client, { TestPage: '/test.js' });
		expect(state.connectedClients.size).toBe(1);
		expect(state.connectedClients.has(client)).toBe(true);
	});

	test('sends manifest message on connect', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		const manifest: Record<string, string> = {
			ReactExample: '/react-abc123.js'
		};
		handleClientConnect(state, client, manifest);

		const sendFn = client.send as ReturnType<typeof mock>;
		expect(sendFn).toHaveBeenCalledTimes(2);

		const [call] = sendFn.mock.calls;
		if (!call) return;
		const manifestMsg = JSON.parse(String(call[0]));
		expect(manifestMsg.type).toBe('manifest');
		expect(manifestMsg.data.manifest).toEqual(manifest);
		expect(manifestMsg.data.serverVersions).toBeDefined();
	});

	test('sends connected message after manifest', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		handleClientConnect(state, client, {});

		const sendFn = client.send as ReturnType<typeof mock>;
		const [, call] = sendFn.mock.calls;
		if (!call) return;
		const connectedMsg = JSON.parse(String(call[0]));
		expect(connectedMsg.type).toBe('connected');
	});
});

describe('handleClientDisconnect', () => {
	test('removes client from connected set', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		state.connectedClients.add(client);
		state.clientTargets.set(client, 'capacitor-ios');
		expect(state.connectedClients.size).toBe(1);

		handleClientDisconnect(state, client);
		expect(state.connectedClients.size).toBe(0);
		expect(state.clientTargets.has(client)).toBe(false);
	});

	test('handles disconnect for non-connected client', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		expect(() => handleClientDisconnect(state, client)).not.toThrow();
	});
});

describe('broadcastToClients', () => {
	test('sends message to all connected clients', () => {
		const state = createHMRState(makeConfig());
		const client1 = makeMockClient();
		const client2 = makeMockClient();
		state.connectedClients.add(client1);
		state.connectedClients.add(client2);

		broadcastToClients(state, { type: 'rebuild-start' });

		expect(client1.send).toHaveBeenCalledTimes(1);
		expect(client2.send).toHaveBeenCalledTimes(1);
	});

	test('adds timestamp to broadcast messages', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		state.connectedClients.add(client);

		broadcastToClients(state, { type: 'test' });

		const sendFn = client.send as ReturnType<typeof mock>;
		const [call] = sendFn.mock.calls;
		if (!call) return;
		const msg = JSON.parse(String(call[0]));
		expect(msg.timestamp).toBeDefined();
		expect(typeof msg.timestamp).toBe('number');
	});

	test('removes clients whose send throws', () => {
		const state = createHMRState(makeConfig());
		const openClient = makeMockClient(WS_READY_STATE_OPEN);
		const closedClient = makeMockClient(3); // CLOSED state
		closedClient.send = mock(() => {
			throw new Error('socket closed');
		}) as unknown as HMRWebSocket['send'];
		state.connectedClients.add(openClient);
		state.connectedClients.add(closedClient);

		broadcastToClients(state, { type: 'test' });

		expect(state.connectedClients.size).toBe(1);
		expect(state.connectedClients.has(openClient)).toBe(true);
		expect(state.connectedClients.has(closedClient)).toBe(false);
	});
});

describe('handleHMRMessage', () => {
	test('responds to ping with pong', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();

		handleHMRMessage(state, client, JSON.stringify({ type: 'ping' }));

		const sendFn = client.send as ReturnType<typeof mock>;
		expect(sendFn).toHaveBeenCalledTimes(1);
		const [pongCall] = sendFn.mock.calls;
		if (!pongCall) return;
		const pong = JSON.parse(String(pongCall[0]));
		expect(pong.type).toBe('pong');
	});

	test('handles Buffer messages', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		const buffer = Buffer.from(JSON.stringify({ type: 'ping' }));

		handleHMRMessage(state, client, buffer);

		const sendFn = client.send as ReturnType<typeof mock>;
		expect(sendFn).toHaveBeenCalledTimes(1);
	});

	test('ignores invalid JSON', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		expect(() => handleHMRMessage(state, client, 'not json')).not.toThrow();
	});

	test('ignores unknown message types', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		handleHMRMessage(
			state,
			client,
			JSON.stringify({ type: 'unknown-type' })
		);
		expect(client.send).not.toHaveBeenCalled();
	});

	test('handles ready message without error', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		expect(() =>
			handleHMRMessage(state, client, JSON.stringify({ type: 'ready' }))
		).not.toThrow();
	});

	test('tracks the declared native client target for diagnostics', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		handleHMRMessage(
			state,
			client,
			JSON.stringify({ target: 'capacitor-ios', type: 'ready' })
		);
		expect(state.clientTargets.get(client)).toBe('capacitor-ios');
	});

	test('labels native HMR application timing with its server/client split', () => {
		const state = createHMRState(makeConfig());
		state.lastHmrFramework = 'react';
		state.lastHmrPath = '/app/react/pages/Account.tsx';
		const client = makeMockClient();
		const lines: string[] = [];
		const originalLog = console.log;
		console.log = (message?: unknown) => lines.push(String(message));
		try {
			handleHMRMessage(
				state,
				client,
				JSON.stringify({
					clientMs: 43,
					duration: 61,
					serverMs: 18,
					target: 'capacitor-android',
					type: 'hmr-timing',
					updateId: 123
				})
			);
		} finally {
			console.log = originalLog;
		}
		expect(lines.some((line) => line.includes('[hmr:android]'))).toBe(true);
		expect(
			lines.some((line) =>
				line.includes('applied in 61ms; server 18ms, client 43ms')
			)
		).toBe(true);
	});

	test('correlates delayed client timing with the update that produced it', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		state.connectedClients.add(client);
		state.lastHmrFramework = 'react';
		state.lastHmrPath = '/react/pages/Current.tsx';
		broadcastToClients(state, {
			data: {
				framework: 'react',
				primarySource: '/react/pages/Original.tsx'
			},
			type: 'react-update'
		});
		const sendFn = client.send as ReturnType<typeof mock>;
		const [broadcastCall] = sendFn.mock.calls;
		if (!broadcastCall) return;
		const update = JSON.parse(String(broadcastCall[0]));
		state.lastHmrPath = '/react/pages/Newer.tsx';

		const lines: string[] = [];
		const originalLog = console.log;
		console.log = (message?: unknown) => lines.push(String(message));
		try {
			handleHMRMessage(
				state,
				client,
				JSON.stringify({
					clientMs: 9,
					duration: 14,
					serverMs: 5,
					target: 'capacitor-android',
					type: 'hmr-timing',
					updateId: update.timestamp
				})
			);
		} finally {
			console.log = originalLog;
		}
		expect(lines.some((line) => line.includes('Original.tsx'))).toBe(true);
		expect(lines.some((line) => line.includes('Newer.tsx'))).toBe(false);
	});

	test('ignores malformed HMR application timing', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		const originalLog = console.log;
		let logged = false;
		console.log = () => {
			logged = true;
		};
		try {
			handleHMRMessage(
				state,
				client,
				JSON.stringify({ duration: 'fast', type: 'hmr-timing' })
			);
		} finally {
			console.log = originalLog;
		}
		expect(logged).toBe(false);
	});

	test('logs native fallback reload outcomes without client error details', () => {
		const state = createHMRState(makeConfig());
		state.lastHmrFramework = 'html';
		state.lastHmrPath = '/html/pages/Example.html';
		const client = makeMockClient();
		const lines: string[] = [];
		const originalLog = console.log;
		console.log = (message?: unknown) => lines.push(String(message));
		try {
			handleHMRMessage(
				state,
				client,
				JSON.stringify({
					clientMs: 7,
					duration: 19,
					kind: 'html',
					outcome: 'reloaded',
					serverMs: 12,
					target: 'capacitor-android',
					type: 'hmr-timing'
				})
			);
		} finally {
			console.log = originalLog;
		}
		expect(
			lines.some((line) =>
				line.includes('falling back to reload after 19ms')
			)
		).toBe(true);
		expect(lines.join('\n')).not.toContain('error');
	});

	test('rejects unknown HMR application outcomes', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		const originalLog = console.log;
		let logged = false;
		console.log = () => {
			logged = true;
		};
		try {
			handleHMRMessage(
				state,
				client,
				JSON.stringify({
					duration: 10,
					outcome: 'exploded',
					type: 'hmr-timing'
				})
			);
		} finally {
			console.log = originalLog;
		}
		expect(logged).toBe(false);
	});
});
