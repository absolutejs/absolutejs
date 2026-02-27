import { resolve } from 'node:path';

export const loadConfig = async (configPath?: string) => {
	const resolved = resolve(
		configPath ?? process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
	);
	const mod = await import(resolved);
	const config = mod.default ?? mod.config;

	if (!config) {
		throw new Error(
			`Config file "${resolved}" does not export a valid configuration.\n` +
				`Expected: export default defineConfig({ ... })`
		);
	}

	return config;
};
