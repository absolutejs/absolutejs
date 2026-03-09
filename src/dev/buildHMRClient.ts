import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as bunBuild } from 'bun';
import { sendTelemetryEvent } from '../cli/telemetryEvent';

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
		sendTelemetryEvent('hmr:client-build-failed', {
			logCount: result.logs.length,
			message: result.logs.map((l) => l.message).join('; ')
		});

		return '// HMR client build failed';
	}

	return await result.outputs[0]!.text();
};
