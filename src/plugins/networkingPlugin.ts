import { argv } from 'node:process';
import { env } from 'bun';
import { Elysia } from 'elysia';
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

export const networkingPlugin = (app: Elysia) =>
	app.listen(
		{
			hostname: host,
			port: port
		},
		() => {
			//TODO: I dont think this works properly
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
