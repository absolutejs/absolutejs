import { Elysia } from 'elysia';
import { env } from 'bun';
import { DEFAULT_PORT } from '../constants';

export const networking = (app: Elysia) => {
	const prev = (globalThis as Record<string, unknown>).__absoluteServer;
	const skipRestart = (globalThis as Record<string, unknown>)
		.__hmrSkipServerRestart;

	if (skipRestart) {
		delete (globalThis as Record<string, unknown>)
			.__hmrSkipServerRestart;
		// Framework change — keep existing server, let HMR handle it
		return app;
	}

	if (prev && typeof prev === 'object' && 'stop' in prev) {
		(prev as { stop: () => void }).stop();
	}

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
	return app;
};
