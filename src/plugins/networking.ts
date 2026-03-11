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

export const networking = (app: Elysia) =>
	app.listen(
		{
			hostname: host,
			port: port
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
				networkUrl: hostFlag ? `http://${localIP}:${port}/` : undefined,
				port,
				version
			});
		}
	);
