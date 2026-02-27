import { env } from 'bun';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { DbScripts } from '../../../types/cli';
import { DEFAULT_PORT } from '../../constants';
import { getDurationString } from '../../utils/getDurationString';
import { formatTimestamp } from '../../utils/logger';
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

export const start = async (serverEntry: string, outdir?: string) => {
	const port = Number(env.PORT) || DEFAULT_PORT;
	killStaleProcesses(port);

	const entryName = basename(serverEntry).replace(/\.[^.]+$/, '');
	const resolvedOutdir = resolve(outdir ?? 'dist');

	// ── Bundle production server ─────────────────────────────────────
	const bundleStart = performance.now();
	process.stdout.write(
		cliTag('\x1b[36m', `Bundling production server`)
	);

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
		entrypoints: [resolve(serverEntry)],
		define: { 'process.env.NODE_ENV': '"production"' },
		external: [
			'@vue/compiler-sfc',
			'svelte/compiler',
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
		for (const log of serverBundle.logs) {
			console.error(log);
		}
		console.error(cliTag('\x1b[31m', 'Server bundle failed.'));
		process.exit(1);
	}

	const outputPath = resolve(resolvedOutdir, `${entryName}.js`);
	if (!existsSync(outputPath)) {
		console.error(
			cliTag('\x1b[31m', `Expected output not found: ${outputPath}`)
		);
		process.exit(1);
	}

	const bundleDuration = getDurationString(performance.now() - bundleStart);
	console.log(` \x1b[2m(${bundleDuration})\x1b[0m`);

	// ── Run production server ────────────────────────────────────────
	const usesDocker = existsSync(resolve(COMPOSE_PATH));
	const scripts: DbScripts | null = usesDocker ? await readDbScripts() : null;

	if (scripts) await startDatabase(scripts);

	let cleaning = false;
	const sessionStart = Date.now();
	sendTelemetryEvent('start:start', { entry: serverEntry });

	const serverProcess = Bun.spawn(['bun', 'run', outputPath], {
		cwd: process.cwd(),
		env: {
			...process.env,
			FORCE_COLOR: '1',
			NODE_ENV: 'production'
		},
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit'
	});

	const cleanup = async (exitCode = 0): Promise<void> => {
		if (cleaning) return;
		cleaning = true;
		sendTelemetryEvent('start:session-duration', {
			duration: Math.round((Date.now() - sessionStart) / 1000),
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
	if (!cleaning) {
		console.error(
			cliTag('\x1b[31m', `Server exited with code ${exitCode}.`)
		);
		sendTelemetryEvent('start:server-exit', {
			exitCode,
			entry: serverEntry
		});
		if (scripts) await stopDatabase(scripts);
		process.exit(exitCode);
	}
};
