import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDurationString } from '../../utils/getDurationString';
import { loadConfig } from '../../utils/loadConfig';
import { formatTimestamp } from '../../utils/startupBanner';
import { sendTelemetryEvent } from '../telemetryEvent';

type TraceEvent = { durationMs: number; name: string };

const PROFILE_TOP = 15;
const PROFILE_COL = 8;
const FRAMEWORK_KEYS = ['react', 'vue', 'svelte', 'angular', 'html', 'htmx'];

const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

// Reads the trace the build writes under .absolute-trace and prints the slowest
// phases plus a per-framework rollup, so you can see where build time goes.
const printProfile = (buildDir: string) => {
	const traceDir = join(buildDir, '.absolute-trace');
	if (!existsSync(traceDir)) return;
	const files = readdirSync(traceDir)
		.filter((file) => file.endsWith('.json'))
		.sort();
	const latest = files[files.length - 1];
	if (latest === undefined) return;

	const trace = JSON.parse(readFileSync(join(traceDir, latest), 'utf-8'));
	const events: TraceEvent[] = Array.isArray(trace.events) ? trace.events : [];
	if (events.length === 0) return;

	const slowest = [...events]
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, PROFILE_TOP);
	const byFramework = FRAMEWORK_KEYS.map((key) => ({
		ms: events
			.filter((event) => event.name.includes(key))
			.reduce((total, event) => total + event.durationMs, 0),
		name: key
	})).filter((entry) => entry.ms > 0);

	const lines = [
		`\n\x1b[1mbuild profile\x1b[0m \x1b[2m· slowest phases\x1b[0m`,
		...slowest.map(
			(event) =>
				`  \x1b[2m${getDurationString(event.durationMs).padStart(PROFILE_COL)}\x1b[0m  ${event.name}`
		),
		`\n\x1b[2mby framework: ${byFramework.map((entry) => `${entry.name} ${getDurationString(entry.ms)}`).join(' · ')}\x1b[0m`
	];
	console.log(lines.join('\n'));
};

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

export const build = async (
	outdir?: string,
	configPath?: string,
	profile = false
) => {
	const resolvedOutdir = resolve(outdir ?? 'build');
	const buildStart = performance.now();
	if (profile) process.env.ABSOLUTE_BUILD_TRACE = '1';
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

	if (profile) printProfile(resolvedOutdir);
};
