import { Elysia } from 'elysia';
import { getHostConfig } from '../utils/hostConfig';

/* Get host configuration from shared utility
   This eliminates code duplication and ensures consistency */
const hostConfig = getHostConfig();

export const networking = (app: Elysia) =>
	app.listen(
		{
			hostname: hostConfig.hostname,
			port: hostConfig.port
		},
		() => {
			if (hostConfig.enabled) {
				// --host flag was used
				if (hostConfig.customHost) {
					// Custom host specified: --host <value>
					// Format matches Vite's console output style
					console.log(`➜  Local:   http://localhost:${hostConfig.port}/`);
					console.log(`➜  Network: http://${hostConfig.customHost}:${hostConfig.port}/`);
				} else {
					// --host with no value: show all network IPs
					// Format matches Vite's console output style
					console.log(`➜  Local:   http://localhost:${hostConfig.port}/`);
					if (hostConfig.networkIPs.length > 0) {
						for (const ip of hostConfig.networkIPs) {
							console.log(`➜  Network: http://${ip}:${hostConfig.port}/`);
						}
					} else {
						console.warn('⚠️  No network IPs detected');
					}
				}
			} else {
				// Default: localhost only
				// Format matches Vite's console output style
				console.log(`➜  Local:   http://${hostConfig.hostname}:${hostConfig.port}/`);
			}
		}
	);
