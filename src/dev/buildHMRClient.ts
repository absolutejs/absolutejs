import { build as bunBuild } from 'bun';
import { resolve } from 'node:path';

export async function buildHMRClient(): Promise<string> {
	const entryPoint = resolve(import.meta.dir, 'client/hmrClient.ts');
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
}
