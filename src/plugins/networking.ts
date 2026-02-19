import { argv } from 'node:process';
import { env } from 'bun';
import { Elysia } from 'elysia';
import { DEFAULT_PORT } from '../constants';
import { getLocalIPAddress } from '../utils/networking';
import { logger } from '../utils/logger';

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
			const isHotReload = !!(globalThis as Record<string, unknown>)
				.__hmrServerStartup;
			(globalThis as Record<string, unknown>).__hmrServerStartup = true;
			if (isHotReload) {
				return;
			}

			const buildDuration =
				((globalThis as Record<string, unknown>).__hmrBuildDuration as
					| number
					| undefined) ?? 0;

			const version =
				((globalThis as Record<string, unknown>).__absoluteVersion as
					| string
					| undefined) ?? '';

			logger.ready({
				duration: buildDuration,
				host,
				networkUrl: hostFlag ? `http://${localIP}:${port}/` : undefined,
				port,
				version
			});
		}
	);
