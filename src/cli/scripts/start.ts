import { env } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { DbScripts } from '../../../types/cli';
import {
	DEFAULT_PORT,
	MAX_ERROR_LENGTH,
	MILLISECONDS_IN_A_SECOND
} from '../../constants';
import { getDurationString } from '../../utils/getDurationString';
import { loadConfig } from '../../utils/loadConfig';
import { formatTimestamp } from '../../utils/startupBanner';
import { sendTelemetryEvent } from '../telemetryEvent';
import {
	COMPOSE_PATH,
	killStaleProcesses,
	readDbScripts,
	startDatabase,
	stopDatabase
} from '../utils';

const cliTag = (color: string, message: string) =>
	`\x1b[2m${formatTimestamp()}\x1b[0m ${color}[cli]\x1b[0m ${color}${message}\x1b[0m`;

const resolvePackageVersion = (candidates: string[]) => {
	for (const candidate of candidates) {
		const version = readPackageVersion(candidate);
		if (version) {
			return version;
		}
	}

	return '';
};

const readPackageVersion = (candidate: string) => {
	try {
		const pkg = JSON.parse(readFileSync(candidate, 'utf-8'));
		if (pkg.name === '@absolutejs/absolute') {
			return pkg.version as string;
		}
	} catch {
		/* try next candidate */
	}

	return null;
};

const resolveBuildModule = async (candidates: string[]) => {
	for (const candidate of candidates) {
		const mod = await tryImportBuild(candidate);
		if (mod) {
			return mod;
		}
	}

	return undefined;
};

const tryImportBuild = async (candidate: string) => {
	try {
		const mod = await import(candidate);

		return mod.build as typeof import('../../core/build').build;
	} catch {
		return null;
	}
};

const handleBundleFailure = (
	serverBundle: {
		logs: Array<{ level: string; message?: { toString(): string } }>;
	},
	bundleStart: number,
	serverEntry: string
) => {
	serverBundle.logs.forEach((log) => {
		console.error(log);
	});
	sendTelemetryEvent('start:bundle-error', {
		durationMs: Math.round(performance.now() - bundleStart),
		entry: serverEntry,
		message:
			serverBundle.logs
				.find((log) => log.level === 'error')
				?.message?.toString()
				.slice(0, MAX_ERROR_LENGTH) ?? 'Unknown error'
	});
	console.error(cliTag('\x1b[31m', 'Server bundle failed.'));
	process.exit(1);
};

export const start = async (
	serverEntry: string,
	outdir?: string,
	configPath?: string
) => {
	const port = Number(env.PORT) || DEFAULT_PORT;
	killStaleProcesses(port);

	const entryName = basename(serverEntry).replace(/\.[^.]+$/, '');
	const resolvedOutdir = resolve(outdir ?? 'dist');

	// ── Resolve package version ─────────────────────────────────────
	const absoluteVersion = resolvePackageVersion([
		resolve(import.meta.dir, '..', '..', '..', 'package.json'),
		resolve(import.meta.dir, '..', '..', 'package.json')
	]);

	// ── Run build step ──────────────────────────────────────────────
	const buildStepStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', `Building assets`));

	const buildConfig = await loadConfig(configPath);
	buildConfig.buildDirectory = resolvedOutdir;
	buildConfig.mode = 'production';

	const frameworks = [
		buildConfig.reactDirectory && 'react',
		buildConfig.htmlDirectory && 'html',
		buildConfig.htmxDirectory && 'htmx',
		buildConfig.svelteDirectory && 'svelte',
		buildConfig.vueDirectory && 'vue',
		buildConfig.angularDirectory && 'angular'
	].filter(Boolean) as string[];

	try {
		const build = await resolveBuildModule([
			resolve(import.meta.dir, '..', '..', 'core', 'build'),
			resolve(import.meta.dir, '..', 'build')
		]);
		if (!build) throw new Error('Could not locate build module');
		await build(buildConfig);
	} catch (err) {
		console.error(cliTag('\x1b[31m', 'Build step failed.'));
		console.error(err);
		process.exit(1);
	}

	const buildStepDuration = getDurationString(
		performance.now() - buildStepStart
	);
	console.log(` \x1b[2m(${buildStepDuration})\x1b[0m`);

	// ── Bundle production server ─────────────────────────────────────
	const bundleStart = performance.now();
	process.stdout.write(cliTag('\x1b[36m', `Bundling production server`));

	const stubPlugin: import('bun').BunPlugin = {
		name: 'stub-framework-sources',
		setup(bld) {
			bld.onLoad({ filter: /\.(svelte|vue)$/ }, () => ({
				contents: 'export default {}',
				loader: 'js'
			}));
			bld.onLoad({ filter: /devBuild\.ts$/ }, () => ({
				contents: 'export const devBuild = () => {}',
				loader: 'js'
			}));
			bld.onLoad({ filter: /core\/build\.ts$/ }, () => ({
				contents: 'export const build = () => ({})',
				loader: 'js'
			}));
			bld.onLoad({ filter: /src\/build\.ts$/ }, () => ({
				contents:
					'export const build = () => ({}); export const devBuild = () => {};',
				loader: 'js'
			}));
			// Stub HMR plugin — only used in dev mode
			bld.onLoad({ filter: /plugins\/hmr\.ts$/ }, () => ({
				contents: 'export const hmr = () => (app) => app;',
				loader: 'js'
			}));
			// Stub dev modules — only used during HMR/dev builds
			bld.onLoad(
				{
					filter: /dev\/(assetStore|clientManager|webSocket|moduleVersionTracker|buildHMRClient)\.ts$/
				},
				() => ({
					contents: 'export {};',
					loader: 'js'
				})
			);
			// Stub telemetry — not needed in production bundle
			bld.onLoad(
				{ filter: /cli\/(telemetryEvent|scripts\/telemetry)\.ts$/ },
				() => ({
					contents:
						'export const sendTelemetryEvent = () => {}; export const getTelemetryConfig = () => null; export const telemetry = () => {};',
					loader: 'js'
				})
			);
			// Stub react-dom legacy browser SSR renderer — only
			// renderToReadableStream (from the bun production file) is used;
			// renderToString / renderToStaticMarkup add ~4 000 lines of dead code.
			bld.onLoad(
				{
					filter: /react-dom-server-legacy\.browser\.(production|development)\.js$/
				},
				() => ({
					contents:
						'exports.renderToString = undefined; exports.renderToStaticMarkup = undefined;',
					loader: 'js'
				})
			);
			// Stub debug — it's a transitive dep of node-cache (via @elysiajs/static)
			// and is a no-op in production anyway. Stubbing it also eliminates ms,
			// has-flag, and supports-color from the bundle.
			bld.onLoad({ filter: /node_modules\/debug/ }, () => ({
				contents:
					'module.exports = () => { const noop = () => {}; noop.enabled = false; return noop; }; module.exports.enable = () => {}; module.exports.disable = () => {}; module.exports.enabled = () => false;',
				loader: 'js'
			}));
			bld.onLoad({ filter: /\.ts$/ }, async (args) => {
				if (args.path.includes('node_modules')) return;
				const text = await Bun.file(args.path).text();
				if (text.includes('@Component')) {
					return {
						contents: 'export default {}',
						loader: 'js'
					};
				}
			});
		}
	};

	const serverBundle = await Bun.build({
		define: { 'process.env.NODE_ENV': '"production"' },
		entrypoints: [resolve(serverEntry)],
		external: [
			'vue',
			'vue/*',
			'@vue/compiler-sfc',
			'@vue/server-renderer',
			'svelte',
			'svelte/*',
			'@angular/compiler',
			'@angular/compiler-cli',
			'@angular/core',
			'@angular/common',
			'@angular/platform-browser',
			'@angular/platform-server'
		],
		outdir: resolvedOutdir,
		plugins: [stubPlugin],
		target: 'bun'
	});

	if (!serverBundle.success) {
		handleBundleFailure(serverBundle, bundleStart, serverEntry);
	}

	const outputPath = resolve(resolvedOutdir, `${entryName}.js`);
	if (!existsSync(outputPath)) {
		console.error(
			cliTag('\x1b[31m', `Expected output not found: ${outputPath}`)
		);
		process.exit(1);
	}

	const bundleDurationMs = Math.round(performance.now() - bundleStart);
	const bundleDuration = getDurationString(performance.now() - bundleStart);
	console.log(` \x1b[2m(${bundleDuration})\x1b[0m`);

	sendTelemetryEvent('start:bundle-complete', {
		durationMs: bundleDurationMs,
		entry: serverEntry
	});

	// ── Run production server ────────────────────────────────────────
	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts: DbScripts | null = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	let cleaning = false;
	const sessionStart = Date.now();
	const totalDuration = performance.now() - buildStepStart;
	sendTelemetryEvent('start:start', {
		buildDurationMs:
			Math.round(performance.now() - buildStepStart) - bundleDurationMs,
		bundleDurationMs,
		entry: serverEntry,
		frameworks,
		totalDurationMs: Math.round(totalDuration)
	});

	const serverProcess = Bun.spawn(['bun', 'run', outputPath], {
		cwd: process.cwd(),
		env: {
			...process.env,
			ABSOLUTE_BUILD_DIR: resolvedOutdir,
			ABSOLUTE_BUILD_DURATION: String(Math.round(totalDuration)),
			ABSOLUTE_VERSION: absoluteVersion,
			FORCE_COLOR: '1',
			NODE_ENV: 'production',
			...(configPath ? { ABSOLUTE_CONFIG: configPath } : {})
		},
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit'
	});

	const cleanup = async (exitCode = 0) => {
		if (cleaning) return;
		cleaning = true;
		sendTelemetryEvent('start:session-duration', {
			duration: Math.round((Date.now() - sessionStart) / MILLISECONDS_IN_A_SECOND),
			entry: serverEntry
		});
		try {
			serverProcess.kill();
		} catch {
			/* process already exited */
		}
		await serverProcess.exited;
		if (scripts) await stopDatabase(scripts);
		process.exit(exitCode);
	};

	process.on('SIGINT', () => cleanup(0));
	process.on('SIGTERM', () => cleanup(0));

	const exitCode = await serverProcess.exited;
	if (cleaning) {
		return;
	}

	console.error(cliTag('\x1b[31m', `Server exited with code ${exitCode}.`));
	sendTelemetryEvent('start:server-exit', {
		entry: serverEntry,
		exitCode
	});
	if (scripts) await stopDatabase(scripts);
	process.exit(exitCode);
};
