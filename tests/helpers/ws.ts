import { devServerReport } from './devServerDiagnostics';

type HMRMessage = { type: string; timestamp?: number; [key: string]: unknown };

const DEFAULT_TIMEOUT_MS = 10_000;

export type HMRClient = {
	messages: HMRMessage[];
	waitFor: (type: string, timeoutMs?: number) => Promise<HMRMessage>;
	waitForSequence: (
		types: string[],
		timeoutMs?: number
	) => Promise<HMRMessage[]>;
	drain: () => HMRMessage[];
	close: () => void;
	ws: WebSocket;
};

const SOCKET_STATES = ['connecting', 'open', 'closing', 'closed'];

const socketState = (
	socket: WebSocket,
	closed: { code?: number; reason?: string }
) => {
	const state = SOCKET_STATES[socket.readyState] ?? String(socket.readyState);

	return closed.code === undefined
		? state
		: `${state} (code ${closed.code}${closed.reason ? `, ${closed.reason}` : ''})`;
};

export const connectHMR = (
	port: number,
	options?: { protocol?: 'ws' | 'wss' }
) =>
	new Promise<HMRClient>((resolve, reject) => {
		const protocol = options?.protocol ?? 'ws';
		// `tls: { rejectUnauthorized: false }` is required for the
		// self-signed cert used in dev-HTTPS tests. Bun's WebSocket
		// honours this option.
		const ws = new WebSocket(`${protocol}://localhost:${port}/hmr`, {
			tls: { rejectUnauthorized: false }
		} as unknown as undefined);
		const messages: HMRMessage[] = [];
		// A socket that closed under a waiting test looks, from the
		// test, exactly like a server that sent nothing.
		const closed: { code?: number; reason?: string } = {};
		ws.onclose = (event) => {
			closed.code = event.code;
			closed.reason = event.reason;
		};
		const waiters: Array<{
			type: string;
			resolve: (msg: HMRMessage) => void;
		}> = [];

		ws.onmessage = (event) => {
			try {
				const msg: HMRMessage = JSON.parse(
					typeof event.data === 'string' ? event.data : ''
				);
				messages.push(msg);

				// Check all waiters (not just first match) to handle out-of-order delivery
				for (let i = waiters.length - 1; i >= 0; i--) {
					const entry = waiters[i];
					if (entry && entry.type === msg.type) {
						waiters.splice(i, 1);
						entry.resolve(msg);
						break;
					}
				}
			} catch {
				// Ignore parse errors
			}
		};

		ws.onopen = () => {
			const client: HMRClient = {
				messages,
				ws,
				close: () => ws.close(),
				drain: () => messages.splice(0, messages.length),
				waitFor: (type, timeoutMs = DEFAULT_TIMEOUT_MS) => {
					// Check already-received messages
					const idx = messages.findIndex((m) => m.type === type);
					if (idx !== -1) {
						const [found] = messages.splice(idx, 1);
						if (found) return Promise.resolve(found);
					}

					return new Promise<HMRMessage>((_resolve, _reject) => {
						const timer = setTimeout(() => {
							const waiterIdx = waiters.findIndex(
								(w) => w.resolve === _resolve
							);
							if (waiterIdx !== -1) waiters.splice(waiterIdx, 1);
							const received = messages
								.map((m) => m.type)
								.join(', ');
							// Why nothing came is the server's to say: whether
							// it saw the edit, and what it has queued.
							void devServerReport(
								port,
								protocol === 'wss' ? 'https' : 'http'
							).then((report) =>
								_reject(
									new Error(
										`Timed out waiting for "${type}" after ${timeoutMs}ms. Received: [${received}]\nThe test's socket is ${socketState(ws, closed)}.\n${report}`
									)
								)
							);
						}, timeoutMs);
						waiters.push({
							type,
							resolve: (msg) => {
								clearTimeout(timer);
								_resolve(msg);
							}
						});
					});
				},
				waitForSequence: async (
					types,
					timeoutMs = DEFAULT_TIMEOUT_MS
				) => {
					const results: HMRMessage[] = [];
					for (const type of types) {
						results.push(await client.waitFor(type, timeoutMs));
					}

					return results;
				}
			};
			resolve(client);
		};

		ws.onerror = (err) =>
			reject(new Error(`WebSocket connection failed: ${err}`));
	});
