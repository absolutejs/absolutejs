/* Graceful shutdown, mounted as a plugin so it can reach the server.
 *
 * `prepare()` returns a plugin; the app calls `.listen()`. So the framework
 * never holds the Bun server directly — but `onStart` hands over the Elysia
 * instance, and `app.server` is the thing to stop. Same capture the static
 * error plugin uses.
 *
 * Production only. In dev the server is restarted constantly by HMR and the
 * dev CLI already owns that lifecycle; draining each rebuild would add a
 * wait to every restart and fight the hand-off, for a shutdown nobody is
 * watching. */

import { Elysia } from 'elysia';
import { installGracefulShutdown } from '../core/gracefulShutdown';
import type { ShutdownConfig } from '../../types/shutdown';

export const shutdown = (config: boolean | ShutdownConfig | undefined) => {
	if (config === false)
		return new Elysia({ name: 'absolutejs-shutdown-disabled' });
	const given: ShutdownConfig = typeof config === 'object' ? config : {};

	return new Elysia({ name: 'absolutejs-shutdown' }).onStart((app) => {
		const { remove } = installGracefulShutdown({
			drainTimeoutMs: given.drainTimeoutMs,
			readinessGraceMs: given.readinessGraceMs,
			server: () => app.server ?? undefined
		});
		/* A server that stops without the process ending — an embedder
		 * running several, a test — must not leave its handlers behind. */
		app.onStop(() => {
			remove();
		});
	});
};
