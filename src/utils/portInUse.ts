/** "Is something already listening on this TCP port?" — answered for every
 *  address family a server can bind, not just the one a single probe
 *  happens to use.
 *
 *  A lone bind probe misses real conflicts: on macOS/BSD a wildcard bind
 *  (0.0.0.0) succeeds next to a listener on a specific address
 *  (127.0.0.1), and an IPv4 bind says nothing about an IPv6-only listener.
 *  So this first tries to connect to both loopbacks (catches any listener
 *  that accepts local traffic), then tries to bind the IPv4 and IPv6
 *  wildcards separately. Connects run before binds so a probe never
 *  connects to its own listener, and every socket is closed before the
 *  result is returned. */

import { spawnSync } from 'node:child_process';
import { createConnection, createServer } from 'node:net';

const CONNECT_TIMEOUT_MS = 300;

const IPV4_LOOPBACK = '127.0.0.1';
const IPV6_LOOPBACK = '::1';
const IPV4_ANY = '0.0.0.0';
const IPV6_ANY = '::';

/** Whether a connection to `host:port` is accepted. */
const acceptsConnection = (port: number, host: string) =>
	new Promise<boolean>((resolve) => {
		const socket = createConnection({ host, port });
		const finish = (accepted: boolean) => {
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.on('error', () => undefined);
			socket.destroy();
			resolve(accepted);
		};
		const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
		socket.once('connect', () => finish(true));
		socket.once('error', () => finish(false));
	});

/** Whether binding `host:port` fails because the address is taken. Any
 *  other failure (no IPv6 on this machine, permission) is not evidence of
 *  a listener, so it reports false. */
const bindConflicts = (port: number, host: string, ipv6Only: boolean) =>
	new Promise<boolean>((resolve) => {
		const server = createServer();
		server.unref();
		server.once('error', (error: NodeJS.ErrnoException) => {
			server.close(() => undefined);
			resolve(error.code === 'EADDRINUSE');
		});
		server.listen({ exclusive: true, host, ipv6Only, port }, () => {
			server.close(() => resolve(false));
		});
	});

/** True when any process listens on `port` over IPv4, IPv6 or both. */
export const isPortInUse = async (port: number) => {
	if (await acceptsConnection(port, IPV4_LOOPBACK)) return true;
	if (await acceptsConnection(port, IPV6_LOOPBACK)) return true;
	if (await bindConflicts(port, IPV4_ANY, false)) return true;

	return bindConflicts(port, IPV6_ANY, true);
};

/** Pids listening on `port`, best effort (lsof; empty where unavailable). */
export const portListenerPids = (port: number) => {
	try {
		const result = spawnSync(
			'lsof',
			['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
			{ encoding: 'utf-8', timeout: 2000 }
		);
		const output = typeof result.stdout === 'string' ? result.stdout : '';

		return [
			...new Set(
				output
					.split('\n')
					.map(Number)
					.filter(
						(pid) =>
							Number.isInteger(pid) &&
							pid > 0 &&
							pid !== process.pid
					)
			)
		];
	} catch {
		return [];
	}
};
