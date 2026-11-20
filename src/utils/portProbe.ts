/** Is anyone already listening on this port?
 *
 *  Under Bun, a bind attempt cannot answer that question:
 *
 *  - `Bun.serve` binds with `SO_REUSEPORT`, so a second bind on a busy
 *    port succeeds and the kernel then splits connections between the two
 *    listeners (UPSTREAM_ISSUES.md #8);
 *  - `node:net`'s `listen` does not raise `EADDRINUSE` either — two
 *    `createServer()` listeners take the same port silently
 *    (UPSTREAM_ISSUES.md #10).
 *
 *  Connecting is the reliable test: nothing of ours is bound yet, so an
 *  accepted connection is somebody else's server. Shared by the dev
 *  server's early listener and its port resolution, because both used to
 *  guess from a bind and both were wrong.
 */

/** How long to wait for the probe before treating the port as free. */
const PROBE_TIMEOUT_MS = 250;

/** A wildcard bind address is not connectable; probe the loopback. */
const probeHost = (host: string) =>
	host === '' || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

/**
 * Whether something answers on `host:port`.
 *
 * Fails open — a probe that times out or errors for any other reason
 * reports the port as free, because a dev server that refuses to start is
 * worse than one that shares a port.
 */
export const isPortTaken = async (host: string, port: number) => {
	try {
		const socket = await Promise.race([
			Bun.connect({
				hostname: probeHost(host),
				port,
				socket: { data: () => undefined, error: () => undefined }
			}),
			Bun.sleep(PROBE_TIMEOUT_MS).then(() => null)
		]);
		if (!socket) return false;
		socket.end();

		return true;
	} catch {
		// Refused: nothing is listening.
		return false;
	}
};
