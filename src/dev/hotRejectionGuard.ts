/* Keep the dev server's timers alive after an unhandled rejection.
 *
 * Under `bun --hot`, Bun counts every unhandled rejection that no
 * `unhandledRejection` listener claims, and never resets the count — not even
 * after a later successful reload. While the count is non-zero Bun treats the
 * event loop as dead and parks the process in a loop that still serves HTTP
 * and delivers fs.watch events but never runs timers (Bun 1.4.0,
 * `VirtualMachine::is_event_loop_alive` + `EventLoop::tick_possibly_forever`).
 *
 * The easiest way to trigger it is a syntax error in any module the server
 * imports: React pages are imported by the server entry, so saving a half-typed
 * JSX edit makes Bun's hot reload reject. From then on the HMR debounce timer
 * never fires: every later edit is seen by the watcher and queued, and nothing
 * rebuilds — including the edit that fixes the error — until the process is
 * restarted. A rejection left unhandled in user code does the same.
 *
 * Claiming the rejection with a listener keeps the count at zero. It is still
 * printed, with the same formatting Bun's default handler uses. */
export const installHotRejectionGuard = () => {
	if (globalThis.__absoluteHotRejectionGuard) return;
	globalThis.__absoluteHotRejectionGuard = true;
	process.on('unhandledRejection', (reason) => {
		console.error(reason);
	});
};
