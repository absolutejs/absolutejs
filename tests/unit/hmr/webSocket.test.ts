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

		const manifestMsg = JSON.parse(sendFn.mock.calls[0][0] as string);
		expect(manifestMsg.type).toBe('manifest');
		expect(manifestMsg.data.manifest).toEqual(manifest);
		expect(manifestMsg.data.serverVersions).toBeDefined();
	});

	test('sends connected message after manifest', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		handleClientConnect(state, client, {});

		const sendFn = client.send as ReturnType<typeof mock>;
		const connectedMsg = JSON.parse(sendFn.mock.calls[1][0] as string);
		expect(connectedMsg.type).toBe('connected');
	});
});

describe('handleClientDisconnect', () => {
	test('removes client from connected set', () => {
		const state = createHMRState(makeConfig());
		const client = makeMockClient();
		state.connectedClients.add(client);
		expect(state.connectedClients.size).toBe(1);

		handleClientDisconnect(state, client);
		expect(state.connectedClients.size).toBe(0);
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
		const msg = JSON.parse(sendFn.mock.calls[0][0] as string);
		expect(msg.timestamp).toBeDefined();
		expect(typeof msg.timestamp).toBe('number');
	});

	test('removes clients with closed connections', () => {
		const state = createHMRState(makeConfig());
		const openClient = makeMockClient(WS_READY_STATE_OPEN);
		const closedClient = makeMockClient(3); // CLOSED state
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
		const pong = JSON.parse(sendFn.mock.calls[0][0] as string);
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
});
