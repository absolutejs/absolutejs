import { resolve } from 'node:path';
import { getDurationString } from '../../utils/getDurationString';
import { loadConfig } from '../../utils/loadConfig';
import { formatTimestamp } from '../../utils/startupBanner';
import { sendTelemetryEvent } from '../telemetryEvent';

const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

const tryImportBuild = async (candidate: string) => {
	try {
		const mod = await import(candidate);
		const buildFn: typeof import('../../core/build').build = mod.build;

		return buildFn;
	} catch {
		return null;
	}
};

const resolveBuildModule = async (candidates: string[]) => {
	const [candidate, ...remaining] = candidates;
	if (!candidate) {
		return undefined;
	}

	const mod = await tryImportBuild(candidate);
	if (mod) {
		return mod;
	}

	return resolveBuildModule(remaining);
};

export const build = async (outdir?: string, configPath?: string) => {
	const resolvedOutdir = resolve(outdir ?? 'build');
	const buildStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', 'Building assets'));

	const buildConfig = await loadConfig(configPath);
	buildConfig.buildDirectory = resolvedOutdir;
	buildConfig.mode = 'production';

	try {
		const buildApp = await resolveBuildModule([
			resolve(import.meta.dir, '..', '..', 'core', 'build'),
			resolve(import.meta.dir, '..', 'build')
		]);
		if (!buildApp) throw new Error('Could not locate build module');
		await buildApp(buildConfig);
	} catch (err) {
		sendTelemetryEvent('build:error', {
			durationMs: Math.round(performance.now() - buildStart)
		});
		console.error(cliTag('\x1b[31m', 'Build step failed.'));
		console.error(err);
		process.exit(1);
	}

	sendTelemetryEvent('build:complete', {
		durationMs: Math.round(performance.now() - buildStart)
	});
	console.log(
		` \x1b[2m(${getDurationString(performance.now() - buildStart)})\x1b[0m`
	);
};
