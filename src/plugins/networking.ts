import { argv } from 'node:process';
import { env } from 'bun';
import { Elysia } from 'elysia';
import type { HMRState } from '../dev/clientManager';
import { hmr } from './hotModuleReloading';
import { DEFAULT_PORT } from '../constants';
import { getLocalIPAddress } from '../utils/networking';

let host = env.HOST ?? 'localhost';
const port = env.PORT ?? DEFAULT_PORT;
let localIP: string | undefined;

const args = argv;
const hostFlag = args.includes('--host');

if (hostFlag) {
	localIP = getLocalIPAddress();
	host = '0.0.0.0';
}

export const networking = (app: Elysia) => {
	if (env.NODE_ENV !== 'production') {
		const devResult = (globalThis as Record<string, unknown>)
			.__hmrDevResult as
			| { manifest: Record<string, string>; hmrState: HMRState }
			| undefined;
		if (devResult?.hmrState && devResult?.manifest) {
			app.use(hmr(devResult.hmrState, devResult.manifest));
		}
	}
	return app.listen(
		{
			hostname: host,
			port: port
		},
		() => {
			if (hostFlag) {
				console.log(`Server started on http://localhost:${port}`);
				console.log(
					`Server started on network: http://${localIP}:${port}`
				);
			} else {
				console.log(`Server started on http://${host}:${port}`);
			}
		}
	);
};
