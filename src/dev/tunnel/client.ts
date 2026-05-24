import {
	decodeTunnelMessage,
	encodeTunnelMessage,
	TUNNEL_CONTROL_PATH,
	TUNNEL_FORWARDED_HOST_HEADER,
	type TunnelResponseMessage,
	type TunnelServerMessage,
	type TunnelWsDataMessage
} from './protocol';

type LocalWsEntry = {
	ws: WebSocket;
	ready: boolean;
	/** Frames from the relay that arrived before the local WS opened. */
	pending: Array<{ bytes: Buffer; binary: boolean }>;
};

type TunnelClientOptions = {
	/** Public relay base URL, e.g. `https://my-relay.ondigitalocean.app`. */
	relayUrl: string;
	/** Shared secret matching the relay's token. */
	token: string;
	/** Local app origin to replay requests against, e.g. `http://localhost:3000`. */
	localOrigin: string;
	/** Called once the relay confirms the public URL is live. */
	onReady?: (publicUrl: string) => void;
};

const RECONNECT_DELAY_MS = 2_000;

const controlSocketUrl = (relayUrl: string, token: string) => {
	const url = new URL(relayUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = TUNNEL_CONTROL_PATH;
	url.search = `?token=${encodeURIComponent(token)}`;

	return url.toString();
};

// Hop-by-hop / relay-injected headers that must not be replayed to the local app.
const STRIPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', TUNNEL_FORWARDED_HOST_HEADER]);

/**
 * Start the dev-side tunnel client. Dials the relay's control socket and
 * replays each forwarded request against the local app, streaming responses
 * back. Auto-reconnects so an HMR restart or a relay blip self-heals.
 */
export const startTunnelClient = (options: TunnelClientOptions) => {
	const publicUrl = options.relayUrl.replace(/\/$/, '');
	const localWsOrigin = options.localOrigin.replace(/^http/, 'ws');
	let socket: WebSocket | null = null;
	let closed = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	const localSockets = new Map<string, LocalWsEntry>();

	const sendFrameToRelay = (id: string, data: string | Buffer, binary: boolean) => {
		const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
		const message: TunnelWsDataMessage = {
			binary,
			dataBase64: bytes.toString('base64'),
			id,
			type: 'ws_data'
		};
		socket?.send(encodeTunnelMessage(message));
	};

	// A public WS reached the relay; open the matching local WS and pipe frames.
	const openLocalWs = (id: string, url: string) => {
		const local = new WebSocket(`${localWsOrigin}${url}`);
		local.binaryType = 'arraybuffer';
		const entry: LocalWsEntry = { pending: [], ready: false, ws: local };
		localSockets.set(id, entry);

		local.addEventListener('open', () => {
			entry.ready = true;
			socket?.send(encodeTunnelMessage({ id, ok: true, type: 'ws_open_ack' }));
			for (const frame of entry.pending) {
				local.send(frame.binary ? frame.bytes : frame.bytes.toString('utf8'));
			}
			entry.pending = [];
		});
		local.addEventListener('message', (event) => {
			if (typeof event.data === 'string') {
				sendFrameToRelay(id, event.data, false);
			} else if (event.data instanceof ArrayBuffer) {
				sendFrameToRelay(id, Buffer.from(event.data), true);
			}
		});
		local.addEventListener('close', (event) => {
			localSockets.delete(id);
			socket?.send(encodeTunnelMessage({ code: event.code, id, type: 'ws_close' }));
		});
		local.addEventListener('error', () => {
			if (!entry.ready) {
				socket?.send(
					encodeTunnelMessage({ error: 'local ws failed', id, ok: false, type: 'ws_open_ack' })
				);
			}
		});
	};

	const forwardFrameToLocal = (message: TunnelWsDataMessage) => {
		const entry = localSockets.get(message.id);
		if (!entry) return;
		const bytes = Buffer.from(message.dataBase64, 'base64');
		if (!entry.ready) {
			entry.pending.push({ binary: message.binary, bytes });

			return;
		}
		entry.ws.send(message.binary ? bytes : bytes.toString('utf8'));
	};

	const handleRequest = async (message: Extract<TunnelServerMessage, { type: 'request' }>) => {
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(message.headers)) {
			if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = value;
		}
		try {
			const response = await fetch(`${options.localOrigin}${message.url}`, {
				body: message.bodyBase64 ? Buffer.from(message.bodyBase64, 'base64') : undefined,
				headers,
				method: message.method,
				redirect: 'manual'
			});
			const bodyBytes = new Uint8Array(await response.arrayBuffer());
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});
			const reply: TunnelResponseMessage = {
				headers: responseHeaders,
				id: message.id,
				status: response.status,
				type: 'response',
				...(bodyBytes.length > 0 ? { bodyBase64: Buffer.from(bodyBytes).toString('base64') } : {})
			};
			socket?.send(encodeTunnelMessage(reply));
		} catch (error) {
			socket?.send(
				encodeTunnelMessage({
					id: message.id,
					message: error instanceof Error ? error.message : String(error),
					type: 'error'
				})
			);
		}
	};

	const connect = () => {
		if (closed) return;
		socket = new WebSocket(controlSocketUrl(options.relayUrl, options.token));

		socket.addEventListener('message', (event) => {
			const message = decodeTunnelMessage(String(event.data));
			if (!message) return;
			switch (message.type) {
				case 'request':
					void handleRequest(message);
					break;
				case 'ready':
					options.onReady?.(publicUrl);
					break;
				case 'ping':
					socket?.send(encodeTunnelMessage({ type: 'pong' }));
					break;
				case 'ws_open':
					openLocalWs(message.id, message.url);
					break;
				case 'ws_data':
					forwardFrameToLocal(message);
					break;
				case 'ws_close':
					localSockets.get(message.id)?.ws.close();
					localSockets.delete(message.id);
					break;
				default:
					break;
			}
		});

		socket.addEventListener('close', () => {
			if (closed) return;
			reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
		});

		socket.addEventListener('error', () => {
			// `close` fires after `error`; reconnect is handled there.
		});
	};

	connect();

	return {
		publicUrl,
		close() {
			closed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			socket?.close();
		}
	};
};
