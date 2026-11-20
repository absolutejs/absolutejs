/** Vite-style dev-server port resolution.
 *
 *  Probes the requested port. If busy, falls through to the next port up
 *  to `portRange-1` neighbors. With `strictPort: true`, fails on the very
 *  first conflict so users who pin a port know immediately.
 *
 *  The probe connects rather than binds. A bind cannot answer the
 *  question under Bun: `node:net`'s `listen` does not raise `EADDRINUSE`
 *  (two `createServer()` listeners silently take the same port), and
 *  `Bun.serve` binds with `SO_REUSEPORT`. Both made an occupied port look
 *  free, so two `absolute dev` servers each believed they had resolved it.
 *  See src/utils/portProbe.ts and UPSTREAM_ISSUES.md #8 and #10. */

import { isPortTaken } from './portProbe';

export type ResolveDevPortOptions = {
	strictPort?: boolean;
	portRange?: number;
	host?: string;
};

export const isPortFree = async (port: number, host = 'localhost') =>
	!(await isPortTaken(host, port));

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
