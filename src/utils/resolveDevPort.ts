/** Vite-style dev-server port resolution.
 *
 *  Probes the requested port. If busy, falls through to the next port up
 *  to `portRange-1` neighbors. With `strictPort: true`, fails on the very
 *  first conflict so users who pin a port know immediately.
 *
 *  Bun's `Bun.serve` rejects EADDRINUSE asynchronously and only after
 *  partially binding, which is awkward to clean up — `node:net.createServer`
 *  is simpler and battle-tested for this exact "is anyone listening here"
 *  probe. */

import { createServer } from 'node:net';

export type ResolveDevPortOptions = {
	strictPort?: boolean;
	portRange?: number;
	host?: string;
};

export const isPortFree = (port: number, host = 'localhost') =>
	new Promise<boolean>((resolvePort) => {
		const server = createServer();
		server.unref();
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				resolvePort(false);

				return;
			}
			// Other errors (EACCES, etc.) — treat as "not free" so we
			// keep probing instead of crashing.
			resolvePort(false);
		});
		server.listen(port, host, () => {
			server.close(() => resolvePort(true));
		});
	});

export type ResolveDevPortResult = {
	port: number;
	fellBack: boolean;
};

export const resolveDevPort = async (
	requestedPort: number,
	options: ResolveDevPortOptions = {}
) => {
	const strictPort = options.strictPort === true;
	const portRange = options.portRange ?? 10;
	const host = options.host ?? 'localhost';

	const tried: number[] = [];
	for (let offset = 0; offset < portRange; offset += 1) {
		const candidate = requestedPort + offset;
		tried.push(candidate);
		// eslint-disable-next-line no-await-in-loop
		const free = await isPortFree(candidate, host);
		if (free) {
			return { fellBack: candidate !== requestedPort, port: candidate };
		}
		if (offset === 0 && strictPort) {
			throw new Error(
				`Port ${requestedPort} is in use, try another port or set strictPort: false in your absolute.config.ts`
			);
		}
	}

	throw new Error(
		`Could not find a free port in the range ${tried[0]}-${tried[tried.length - 1]}. Tried: ${tried.join(', ')}.\n` +
			`Set \`dev.port\` to a different value in absolute.config.ts (or via the ABSOLUTE_PORT env var), or extend \`dev.portRange\`.`
	);
};
