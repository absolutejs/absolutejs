import { argv } from 'node:process';
import { env } from 'bun';
import { DEFAULT_PORT } from '../constants';
import type { BuildConfig } from '../types';
import { getAllNetworkIPs } from './networking';

/* Host configuration type
   This handles the "host config structure" problem */
export type HostConfig = {
	enabled: boolean;
	hostname: string;
	port: number;
	customHost?: string;
	networkIPs: string[];
};

/* Parse --host flag from command line arguments
   This handles the "parse host flag" problem */
function parseHostFlag(args: string[]): { enabled: boolean; value?: string } {
	const hostIndex = args.indexOf('--host');
	
	if (hostIndex === -1) {
		return { enabled: false };
	}
	
	// Check if there's a value after --host
	const nextArg = args[hostIndex + 1];
	
	// If next argument exists and doesn't start with '--', it's the host value
	if (nextArg && !nextArg.startsWith('--')) {
		return { enabled: true, value: nextArg };
	}
	
	// --host with no value means bind to 0.0.0.0
	return { enabled: true };
}

/* Get host configuration from command line, config, environment, or defaults
   Priority: CLI flag > config > environment variable > default
   This handles the "get host config" problem */
export function getHostConfig(config?: BuildConfig): HostConfig {
	const args = argv;
	const hostFlag = parseHostFlag(args);
	
	// Priority 1: CLI flag (--host)
	// Priority 2: config.host
	// Priority 3: environment variable (HOST)
	// Priority 4: default (localhost)
	
	let hostname: string;
	let enabled = false;
	let networkIPs: string[] = [];
	let customHost: string | undefined;
	
	// Determine hostname with priority
	if (hostFlag.enabled) {
		// CLI flag takes highest priority
		enabled = true;
		if (hostFlag.value) {
			// Custom host specified: --host <value>
			customHost = hostFlag.value;
			hostname = hostFlag.value;
		} else {
			// --host with no value: bind to 0.0.0.0 and detect network IPs
			hostname = '0.0.0.0';
			networkIPs = getAllNetworkIPs();
		}
	} else if (config?.host !== undefined) {
		// Config takes second priority
		enabled = true;
		if (typeof config.host === 'string') {
			// Custom host specified in config
			customHost = config.host;
			hostname = config.host;
		} else if (config.host === true) {
			// true means bind to 0.0.0.0
			hostname = '0.0.0.0';
			networkIPs = getAllNetworkIPs();
		} else {
			// false means localhost (but this shouldn't happen if enabled is true)
			hostname = 'localhost';
		}
	} else {
		// Environment variable or default
		hostname = env.HOST ?? 'localhost';
	}
	
	// Port priority: CLI flag (--port) > config.port > environment variable (PORT) > default
	const envPort = env.PORT ? Number(env.PORT) : undefined;
	const port = config?.port ?? envPort ?? DEFAULT_PORT;
	
	return {
		enabled,
		hostname,
		port,
		customHost,
		networkIPs
	};
}

