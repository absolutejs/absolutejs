import { startTunnelRelay } from '../../dev/tunnel/relay';

/**
 * `absolute tunnel-relay` — run the public reverse-tunnel relay (typically on a
 * small always-on host like a DO App Platform service). Dev machines connect to
 * it with `dev: { tunnel: { relay, token } }`. Reads:
 *   - PORT (App Platform injects this; default 8787)
 *   - ABSOLUTE_TUNNEL_TOKEN (required shared secret)
 *   - ABSOLUTE_TUNNEL_PUBLIC_URL (optional; the relay's public base URL)
 */
export const tunnelRelay = () => {
	const token = process.env.ABSOLUTE_TUNNEL_TOKEN;
	if (!token) {
		console.error('[tunnel-relay] ABSOLUTE_TUNNEL_TOKEN is required.');
		process.exit(1);
	}

	startTunnelRelay({
		port: Number(process.env.PORT) || undefined,
		publicUrl: process.env.ABSOLUTE_TUNNEL_PUBLIC_URL,
		token
	});
	// Bun.serve keeps the process alive; nothing else to do.
};
