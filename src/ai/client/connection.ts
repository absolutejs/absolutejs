import type {
	AIClientMessage,
	AIConnectionOptions,
	AIServerMessage
} from '../../../types/ai';
import { isValidAIServerMessage } from '../../../types/typeGuards';

const WS_OPEN = 1;
const WS_NORMAL_CLOSURE = 1000;
const WS_CLOSED = 3;
const DEFAULT_PING_INTERVAL = 30_000;
const RECONNECT_INITIAL_DELAY = 500;
const RECONNECT_POLL_INTERVAL = 300;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 60;

type AIConnectionState = {
	isConnected: boolean;
	pendingMessages: string[];
	pingInterval: ReturnType<typeof setInterval> | null;
	reconnectAttempts: number;
	reconnectTimeout: ReturnType<typeof setTimeout> | null;
	ws: WebSocket | null;
};

type AIConnectionHandle = {
	close: () => void;
	getReadyState: () => number;
	send: (msg: AIClientMessage) => void;
	subscribe: (callback: (msg: AIServerMessage) => void) => () => void;
};

// eslint-disable-next-line no-empty-function
const noop = () => {};
const noopUnsubscribe = () => noop;

const NOOP_CONNECTION: AIConnectionHandle = {
	close: noop,
	send: noop,
	subscribe: noopUnsubscribe,
	getReadyState: () => WS_CLOSED
};

const buildWsUrl = (path: string) => {
	const { hostname, port, protocol } = window.location;
	const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
	const portSuffix = port ? `:${port}` : '';

	return `${wsProtocol}//${hostname}${portSuffix}${path}`;
};

const parseServerMessage = (event: MessageEvent) => {
	let data: unknown;

	try {
		data = JSON.parse(String(event.data));
	} catch {
		return null;
	}

	if (
		data &&
		typeof data === 'object' &&
		'type' in data &&
		data.type === 'pong'
	) {
		return null;
	}

	if (!isValidAIServerMessage(data)) {
		return null;
	}

	return data;
};

export const createAIConnection = (
	path: string,
	options: AIConnectionOptions = {}
) => {
	if (typeof window === 'undefined') {
		return NOOP_CONNECTION;
	}

	const shouldReconnect = options.reconnect !== false;
	const pingInterval = options.pingInterval ?? DEFAULT_PING_INTERVAL;
	const maxReconnectAttempts =
		options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;

	const listeners = new Set<(msg: AIServerMessage) => void>();

	const connState: AIConnectionState = {
		isConnected: false,
		pendingMessages: [],
		pingInterval: null,
		reconnectAttempts: 0,
		reconnectTimeout: null,
		ws: null
	};

	const flushPendingMessages = () => {
		if (connState.ws?.readyState !== WS_OPEN) {
			return;
		}

		while (connState.pendingMessages.length > 0) {
			const next = connState.pendingMessages.shift();
			if (typeof next === 'string') {
				connState.ws.send(next);
			}
		}
	};

	const clearTimers = () => {
		if (connState.pingInterval) {
			clearInterval(connState.pingInterval);
			connState.pingInterval = null;
		}

		if (connState.reconnectTimeout) {
			clearTimeout(connState.reconnectTimeout);
			connState.reconnectTimeout = null;
		}
	};

	const scheduleReconnect = () => {
		connState.reconnectAttempts++;
		const delay =
			connState.reconnectAttempts === 1
				? RECONNECT_INITIAL_DELAY
				: RECONNECT_POLL_INTERVAL;

		connState.reconnectTimeout = setTimeout(() => {
			if (connState.reconnectAttempts > maxReconnectAttempts) {
				return;
			}

			connect();
		}, delay);
	};

	const connect = () => {
		const url = buildWsUrl(path);
		const wsInstance = new WebSocket(url, options.protocols);

		wsInstance.onopen = () => {
			connState.isConnected = true;
			connState.reconnectAttempts = 0;
			flushPendingMessages();

			connState.pingInterval = setInterval(() => {
				if (
					wsInstance.readyState === WS_OPEN &&
					connState.isConnected
				) {
					wsInstance.send(JSON.stringify({ type: 'ping' }));
				}
			}, pingInterval);
		};

		wsInstance.onmessage = (event: MessageEvent) => {
			const message = parseServerMessage(event);

			if (!message) {
				return;
			}

			listeners.forEach((listener) => listener(message));
		};

		wsInstance.onclose = (event: CloseEvent) => {
			connState.isConnected = false;
			clearTimers();

			const shouldAttemptReconnect =
				shouldReconnect &&
				event.code !== WS_NORMAL_CLOSURE &&
				connState.reconnectAttempts < maxReconnectAttempts;

			if (shouldAttemptReconnect) {
				scheduleReconnect();
			}
		};

		wsInstance.onerror = () => {
			// Error is followed by close event, reconnection handled there
		};

		connState.ws = wsInstance;
	};

	const send = (msg: AIClientMessage) => {
		const serialized = JSON.stringify(msg);

		if (connState.ws?.readyState === WS_OPEN) {
			connState.ws.send(serialized);

			return;
		}

		connState.pendingMessages.push(serialized);
	};

	const subscribe = (callback: (msg: AIServerMessage) => void) => {
		listeners.add(callback);

		return () => {
			listeners.delete(callback);
		};
	};

	const close = () => {
		clearTimers();

		if (connState.ws) {
			connState.ws.close(WS_NORMAL_CLOSURE);
			connState.ws = null;
		}

		connState.isConnected = false;
		listeners.clear();
	};

	const getReadyState = () => connState.ws?.readyState ?? WS_CLOSED;

	connect();

	return { close, getReadyState, send, subscribe };
};
