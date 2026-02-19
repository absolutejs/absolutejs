import { existsSync } from 'node:fs';
import { build as bunBuild } from 'bun';
import { resolve } from 'node:path';

const hmrClientPath = (() => {
	const fromSource = resolve(import.meta.dir, 'client/hmrClient.ts');
	if (existsSync(fromSource)) return fromSource;

	return resolve(import.meta.dir, 'dev/client/hmrClient.ts');
})();

export const buildHMRClient = async () => {
	const entryPoint = hmrClientPath;
	const result = await bunBuild({
		entrypoints: [entryPoint],
		format: 'iife',
		minify: false,
		target: 'browser'
	});
	if (!result.success) {
		console.error('Failed to build HMR client:', result.logs);
		return '// HMR client build failed';
	}
	return await result.outputs[0]!.text();
};
