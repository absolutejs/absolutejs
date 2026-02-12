import type { HMRState } from '../dev/clientManager';
import { broadcastToClients } from '../dev/webSocket';
import { Elysia } from 'elysia';
import { env } from 'bun';
import { DEFAULT_PORT } from '../constants';

const FULL_RELOAD_DELAY_MS = 80;

export type NetworkingOptions = {
	hmrState?: HMRState | null;
};

const isElysiaInstance = (value: unknown): value is Elysia =>
	value !== null && typeof value === 'object' && 'fetch' in (value as object);

export const networking = (appOrOptions?: Elysia | NetworkingOptions) => {
	if (isElysiaInstance(appOrOptions)) {
		return setupNetworking(appOrOptions, undefined);
	}
	return (app: Elysia) =>
		setupNetworking(app, appOrOptions as NetworkingOptions | undefined);
};

function setupNetworking(app: Elysia, options?: NetworkingOptions): Elysia {
	const prev = (globalThis as Record<string, unknown>).__absoluteServer;
	const skipRestart = (globalThis as Record<string, unknown>)
		.__hmrSkipServerRestart;

	if (skipRestart) {
		delete (globalThis as Record<string, unknown>).__hmrSkipServerRestart;
		// Framework change — keep existing server, let HMR handle it
		return app;
	}

	const doListen = () => {
		app.listen(
			{
				hostname: env.HOST ?? 'localhost',
				port: env.PORT ? Number(env.PORT) : DEFAULT_PORT
			},
			() => {
				const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
				if (prev) {
					console.log(
						`\x1b[36m[hmr] Server listening on port ${port}\x1b[0m`
					);
				} else {
					console.log(`➜  Local:   http://localhost:${port}/`);
				}
			}
		);
		(globalThis as Record<string, unknown>).__absoluteServer = app.server;
	};

	if (prev && typeof prev === 'object' && 'stop' in prev) {
		const hmrState = options?.hmrState;
		if (hmrState?.connectedClients?.size) {
			broadcastToClients(hmrState, { type: 'full-reload' });
			setTimeout(() => {
				(prev as { stop: () => void }).stop();
				process.exit(0);
			}, FULL_RELOAD_DELAY_MS);
		} else {
			(prev as { stop: () => void }).stop();
			process.exit(0);
		}
	} else {
		doListen();
	}

	return app;
}
