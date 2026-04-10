import { argv } from 'node:process';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { DEFAULT_PORT } from '../constants';
import { loadDevCert } from '../dev/devCert';
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

// TLS is enabled via ABSOLUTE_HTTPS env var set by the config loader
const loadTls = () => {
	if (env.NODE_ENV !== 'development') return undefined;
	if (env.ABSOLUTE_HTTPS !== 'true') return undefined;

	try {
		return loadDevCert();
	} catch {
		return undefined;
	}
};
const tls = loadTls();
const protocol = tls ? 'https' : 'http';

export const networking = <A extends Elysia>(app: A) =>
	app.listen(
		{
			hostname: host,
			port: port,
			...(tls
				? {
						tls: {
							cert: tls.cert,
							key: tls.key
						}
					}
				: {})
		},
		() => {
			// Skip logging on Bun --hot reloads (HMR handles its own output)
			const isHotReload = Boolean(globalThis.__hmrServerStartup);
			globalThis.__hmrServerStartup = true;
			if (isHotReload) {
				return;
			}

			const buildDuration =
				globalThis.__hmrBuildDuration ??
				Number(env.ABSOLUTE_BUILD_DURATION || 0);

			const version =
				globalThis.__absoluteVersion || env.ABSOLUTE_VERSION || '';

			startupBanner({
				duration: buildDuration,
				host,
				networkUrl: hostFlag
					? `${protocol}://${localIP}:${port}/`
					: undefined,
				port,
				protocol,
				version
			});
		}
	);
