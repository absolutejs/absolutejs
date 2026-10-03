import { resolve } from 'node:path';
import { loadConfig } from '../../utils/loadConfig';
import { installHotResources } from '../hotResources';
import { installHotModulePlugin } from './plugin';

/* Turn on backend HMR for this dev process (see docs/BACKEND_HMR.md):
 * attribute what top-level statements start, and serve the app's server
 * modules through the hot runtime. Runs before the server entry is first
 * imported. `ABSOLUTE_BACKEND_HMR=0` turns it off; edits to server code
 * then restart the server, as they did before. */

const configuredDirectories = async (configPath: string) => {
	try {
		const config = await loadConfig(configPath);

		return [
			config.reactDirectory,
			config.svelteDirectory,
			config.vueDirectory,
			config.angularDirectory,
			config.emberDirectory,
			config.htmlDirectory,
			config.htmxDirectory,
			config.buildDirectory ?? 'build',
			config.assetsDirectory,
			config.publicDirectory
		].filter((dir): dir is string => typeof dir === 'string' && dir !== '');
	} catch {
		return ['build'];
	}
};

export const startBackendHmr = async (entryPath: string) => {
	if (globalThis.__absoluteBackendHmr !== undefined)
		return globalThis.__absoluteBackendHmr;
	if (process.env.ABSOLUTE_BACKEND_HMR === '0') {
		globalThis.__absoluteBackendHmr = false;

		return false;
	}
	installHotResources();
	const configPath = resolve(
		process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
	);
	const installed = await installHotModulePlugin({
		configPath,
		entryPath,
		excludedDirs: await configuredDirectories(configPath),
		root: process.cwd()
	});
	globalThis.__absoluteBackendHmr = installed;

	return installed;
};
