import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { DEFAULT_PORT } from '../constants';
import { getLocalIPAddress } from '../utils/networking';
import { startupBanner } from '../utils/startupBanner';

let host = env.HOST ?? 'localhost';
const port = env.PORT ?? DEFAULT_PORT;
let localIP: string | undefined;

const args = argv;
const hostFlag = args.includes('--host');

if (hostFlag) {
	localIP = getLocalIPAddress();
	host = '0.0.0.0';
}

const isHttpsDev =
	env.NODE_ENV === 'development' && env.ABSOLUTE_HTTPS === 'true';
const protocol = isHttpsDev ? 'https' : 'http';

const showBanner = () => {
	const isHotReload = Boolean(globalThis.__hmrServerStartup);
	globalThis.__hmrServerStartup = true;
	if (isHotReload) return;

	startupBanner({
		duration:
			globalThis.__hmrBuildDuration ??
			Number(env.ABSOLUTE_BUILD_DURATION || 0),
		host,
		networkUrl: hostFlag ? `${protocol}://${localIP}:${port}/` : undefined,
		port,
		protocol,
		version: globalThis.__absoluteVersion || env.ABSOLUTE_VERSION || ''
	});
};

export const networking = (app: Elysia) => {
	if (isHttpsDev) {
		const certDir = join(process.cwd(), '.absolutejs');
		const cert = readFileSync(join(certDir, 'cert.pem'), 'utf-8');
		const key = readFileSync(join(certDir, 'key.pem'), 'utf-8');

		app.compile();

		const http2 = require('node:http2');
		const server = http2.createSecureServer({
			cert,
			key,
			settings: { enableConnectProtocol: true }
		});

		// Force enableConnectProtocol on each session so browsers
		// know they can use Extended CONNECT for WebSocket (RFC 8441)
		server.on(
			'session',
			(session: { settings: (s: Record<string, boolean>) => void }) => {
				session.settings({ enableConnectProtocol: true });
			}
		);

		const { bridgeHttp2Stream } = require('../dev/http2Bridge');
		const http2Config = globalThis.__http2Config;

		server.on(
			'stream',
			(
				stream: import('node:http2').ServerHttp2Stream,
				headers: import('node:http2').IncomingHttpHeaders
			) => {
				bridgeHttp2Stream(
					stream,
					headers,
					app.fetch.bind(app),
					http2Config?.hmrState,
					http2Config?.manifest
				);
			}
		);

		// Bun's node:http2 loses ALPN negotiation when a hostname is passed
		// to listen(). Omitting the hostname binds to all interfaces which
		// is correct for the dev server.
		server.listen(Number(port), () => {
			showBanner();
		});

		return app;
	}

	// Non-HTTP/2: TLS via Bun.serve or plain HTTP
	const tls = (() => {
		if (!isHttpsDev) return undefined;
		try {
			const { loadDevCert } = require('../dev/devCert');
			return loadDevCert();
		} catch {
			return undefined;
		}
	})();

	return app.listen(
		{
			hostname: host,
			port: port,
			...(tls ? { tls: { cert: tls.cert, key: tls.key } } : {})
		},
		() => {
			showBanner();
		}
	);
};
