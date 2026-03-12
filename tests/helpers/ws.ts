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

export const connectHMR = (port: number) =>
	new Promise<HMRClient>((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${port}/hmr`);
		const messages: HMRMessage[] = [];
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
					if (waiters[i].type === msg.type) {
						const [waiter] = waiters.splice(i, 1);
						waiter.resolve(msg);
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

						return Promise.resolve(found);
					}

					return new Promise<HMRMessage>((_resolve, _reject) => {
						const timer = setTimeout(() => {
							const waiterIdx = waiters.findIndex(
								(w) => w.resolve === _resolve
							);
							if (waiterIdx !== -1) waiters.splice(waiterIdx, 1);
							_reject(
								new Error(
									`Timed out waiting for "${type}" after ${timeoutMs}ms. Received: [${messages.map((m) => m.type).join(', ')}]`
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
