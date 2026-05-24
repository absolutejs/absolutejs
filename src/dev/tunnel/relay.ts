import type { ServerWebSocket } from 'bun';
import {
	decodeTunnelMessage,
	encodeTunnelMessage,
	TUNNEL_CONTROL_PATH,
	TUNNEL_FORWARDED_HOST_HEADER,
	type TunnelClientMessage,
	type TunnelRequestMessage
} from './protocol';

type RelayOptions = {
	/** Port the relay listens on (App Platform injects PORT). */
	port?: number;
	/** Shared secret the dev client must present (?token=). */
	token: string;
	/** Public base URL the relay is reachable at. Falls back to the request
	 *  origin when omitted (App Platform: set APP_URL or pass explicitly). */
	publicUrl?: string;
	/** How long to wait for the dev client to answer a forwarded request. */
	requestTimeoutMs?: number;
};

type ControlSocketData = { control: true };
type PublicSocketData = {
	control: false;
	id: string;
	url: string;
	headers: Record<string, string>;
};
type SocketData = ControlSocketData | PublicSocketData;

const DEFAULT_RELAY_PORT = 8787;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const headersToObject = (headers: Headers) => {
	const out: Record<string, string> = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});

	return out;
};

/**
 * Start the public reverse-tunnel relay. Holds one dev-client control socket
 * and forwards every other inbound HTTP request — and public WebSocket — down
 * it. Single-tenant: the shared `token` gates the control channel.
 */
export const startTunnelRelay = (options: RelayOptions) => {
	const port = options.port ?? (Number(process.env.PORT) || DEFAULT_RELAY_PORT);
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

	let client: ServerWebSocket<SocketData> | null = null;
	const pending = new Map<string, (message: TunnelClientMessage) => void>();
	const publicSockets = new Map<string, ServerWebSocket<SocketData>>();

	const resolvePublicUrl = (request: Request) => {
		if (options.publicUrl) return options.publicUrl.replace(/\/$/, '');
		const url = new URL(request.url);
		const host = request.headers.get('x-forwarded-host') ?? url.host;
		const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');

		return `${proto}://${host}`;
	};

	const isWebSocketUpgrade = (request: Request) =>
		request.headers.get('upgrade')?.toLowerCase() === 'websocket';

	const server = Bun.serve<SocketData>({
		port,
		websocket: {
			close(ws) {
				if (ws.data.control) {
					if (client === ws) client = null;

					return;
				}
				publicSockets.delete(ws.data.id);
				client?.send(encodeTunnelMessage({ id: ws.data.id, type: 'ws_close' }));
			},
			message(ws, raw) {
				// Public socket: forward the raw frame to the dev client.
				if (!ws.data.control) {
					const binary = typeof raw !== 'string';
					const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.from(raw);
					client?.send(
						encodeTunnelMessage({
							binary,
							dataBase64: bytes.toString('base64'),
							id: ws.data.id,
							type: 'ws_data'
						})
					);

					return;
				}

				// Control socket: messages from the dev client.
				const message = decodeTunnelMessage(
					typeof raw === 'string' ? raw : raw.toString()
				);
				if (!message) return;
				switch (message.type) {
					case 'ping':
						ws.send(encodeTunnelMessage({ type: 'pong' }));
						break;
					case 'response':
					case 'error':
						pending.get(message.id)?.(message);
						break;
					case 'ws_open_ack':
						if (!message.ok) publicSockets.get(message.id)?.close();
						break;
					case 'ws_data': {
						const target = publicSockets.get(message.id);
						const bytes = Buffer.from(message.dataBase64, 'base64');
						target?.send(message.binary ? bytes : bytes.toString('utf8'));
						break;
					}
					case 'ws_close':
						publicSockets.get(message.id)?.close(message.code, message.reason);
						publicSockets.delete(message.id);
						break;
					default:
						break;
				}
			},
			open(ws) {
				if (ws.data.control) {
					// Single-tenant: a new client replaces any stale one.
					client = ws;
					ws.send(encodeTunnelMessage({ publicUrl: options.publicUrl ?? '', type: 'ready' }));

					return;
				}
				// Public WS: register it and ask the dev client to open the local peer.
				publicSockets.set(ws.data.id, ws);
				client?.send(
					encodeTunnelMessage({
						headers: ws.data.headers,
						id: ws.data.id,
						type: 'ws_open',
						url: ws.data.url
					})
				);
			}
		},
		async fetch(request, srv) {
			const url = new URL(request.url);

			// Dev client connects here to open the control channel.
			if (url.pathname === TUNNEL_CONTROL_PATH) {
				if (url.searchParams.get('token') !== options.token) {
					return new Response('Forbidden', { status: 403 });
				}
				const upgraded = srv.upgrade(request, { data: { control: true } });

				return upgraded ? undefined : new Response('Upgrade failed', { status: 426 });
			}

			if (!client) {
				return new Response('Tunnel offline: no dev client connected.', { status: 503 });
			}

			// Public WebSocket (e.g. Twilio Media Stream) → tunnel it by id.
			if (isWebSocketUpgrade(request)) {
				const id = crypto.randomUUID();
				const upgraded = srv.upgrade(request, {
					data: {
						control: false,
						headers: headersToObject(request.headers),
						id,
						url: url.pathname + url.search
					}
				});

				return upgraded ? undefined : new Response('Upgrade failed', { status: 426 });
			}

			// Public HTTP request → forward and await the dev client's response.
			const id = crypto.randomUUID();
			const bodyBytes = ['GET', 'HEAD'].includes(request.method)
				? null
				: new Uint8Array(await request.arrayBuffer());
			const headers = headersToObject(request.headers);
			headers[TUNNEL_FORWARDED_HOST_HEADER] = resolvePublicUrl(request);

			const message: TunnelRequestMessage = {
				headers,
				id,
				method: request.method,
				type: 'request',
				url: url.pathname + url.search,
				...(bodyBytes && bodyBytes.length > 0
					? { bodyBase64: Buffer.from(bodyBytes).toString('base64') }
					: {})
			};

			const responsePromise = new Promise<TunnelClientMessage>((resolve) => {
				pending.set(id, resolve);
			});
			client.send(encodeTunnelMessage(message));

			const timeout = new Promise<TunnelClientMessage>((resolve) =>
				setTimeout(() => resolve({ id, message: 'timeout', type: 'error' }), requestTimeoutMs)
			);
			const result = await Promise.race([responsePromise, timeout]);
			pending.delete(id);

			if (result.type === 'error') {
				return new Response(`Tunnel error: ${result.message}`, { status: 504 });
			}
			if (result.type !== 'response') {
				return new Response('Tunnel protocol error', { status: 502 });
			}

			return new Response(
				result.bodyBase64 ? Buffer.from(result.bodyBase64, 'base64') : null,
				{ headers: result.headers, status: result.status }
			);
		}
	});

	console.info(`[tunnel-relay] listening on :${server.port} (control ${TUNNEL_CONTROL_PATH})`);

	return server;
};
