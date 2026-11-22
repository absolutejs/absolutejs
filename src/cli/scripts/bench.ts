/* `absolute bench [--save] [--check] [--json]`
 *
 * Reproducible numbers for this project, and a gate that fails when they
 * get worse.
 *
 * What already existed: `--profile` prints per-framework build time and
 * writes it to `.absolute-trace/`, and `analyze --check` enforces
 * absolute size budgets. Neither records anything across runs, so
 * "did this release get slower?" had no answer. One benchmark is
 * committed — `benchmarks/angular-hmr/` — and it measures HMR latency
 * for one framework against a pinned old version.
 *
 * What this is NOT: a comparison against Next.js, Nuxt or SvelteKit.
 * That is what plan item 1.9 asks for and it is a separate project with
 * real methodology risk — an unfair benchmark published by the project
 * itself costs more credibility than no benchmark. This measures
 * AbsoluteJS against its own past, which is the part that pays off every
 * CI run and claims nothing it has not earned. */

import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../utils/loadConfig';
import { formatBytes } from '../../utils/formatBytes';
import { getDurationString } from '../../utils/getDurationString';
import { startProject } from '../../testing/project';
import { measureThroughput } from '../../bench/load';
import {
	compareRecords,
	median,
	sizesByFramework,
	summarizeThroughput,
	type BenchRecord,
	type Regression,
	type ThroughputResult
} from '../../bench/metrics';
import { colors } from '../tuiPrimitives';
import type { BenchPage } from '../../../types/bench';

const BASELINE_FILE = '.absolute-bench-baseline.json';
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_DURATION_MS = 3_000;
const DEFAULT_WARMUP_MS = 1_000;
const DEFAULT_RUNS = 1;
const LABEL_WIDTH = 14;
const FRAMEWORK_NAMES = [
	'angular',
	'ember',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
];

const flagValue = (args: readonly string[], flag: string) => {
	const index = args.indexOf(flag);

	return index >= 0 ? args[index + 1] : undefined;
};

const sizeOf = (path: string) => {
	try {
		return statSync(path).size;
	} catch {
		return 0;
	}
};

/* A manifest value is either a web path served from the build directory
 * or an absolute filesystem path the server imports. Both start with
 * `/`; resolving only the first shape is what made `analyze` report 0
 * for every server entry before beta.303. */
const resolveAsset = (buildDir: string, value: string) => {
	const relative = join(buildDir, value.replace(/^\//, ''));
	if (existsSync(relative)) return relative;

	return existsSync(value) ? value : relative;
};

/** Per-framework build time from the trace the build just wrote. */
const buildTimeByFramework = (buildDir: string) => {
	const traceDir = join(buildDir, '.absolute-trace');
	if (!existsSync(traceDir)) return undefined;
	const files = readdirSync(traceDir)
		.filter((file) => file.endsWith('.json'))
		.sort();
	const latest = files.at(-1);
	if (latest === undefined) return undefined;
	try {
		const trace: { events?: { durationMs: number; name: string }[] } =
			JSON.parse(readFileSync(join(traceDir, latest), 'utf-8'));
		const events = trace.events ?? [];
		const msFor = (name: string) =>
			Math.round(
				events
					.filter((event) => event.name.includes(name))
					.reduce((sum, event) => sum + event.durationMs, 0)
			);

		return Object.fromEntries(
			FRAMEWORK_NAMES.map((name) => [name, msFor(name)]).filter(
				([, total]) => Number(total) > 0
			)
		);
	} catch {
		return undefined;
	}
};

const runBuildOnce = async (configPath: string | undefined, outdir: string) => {
	const started = performance.now();
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(import.meta.dir, '..', 'index.ts'),
			'build',
			'--profile',
			'--outdir',
			outdir,
			...(configPath === undefined ? [] : ['--config', configPath])
		],
		{
			env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
			stderr: 'ignore',
			stdout: 'ignore'
		}
	);
	const code = await child.exited;
	if (code !== 0)
		throw new Error(
			`The build failed, so there is nothing to measure. Run \`absolute build\` and fix it first.`
		);

	return performance.now() - started;
};

type ThroughputArgs = {
	concurrency: number;
	configPath: string | undefined;
	durationMs: number;
	pages: BenchPage[];
	serverEntry: string | undefined;
	warmupMs: number;
};

const measurePages = async ({
	concurrency,
	configPath,
	durationMs,
	pages,
	serverEntry,
	warmupMs
}: ThroughputArgs) => {
	if (pages.length === 0) return undefined;
	process.stdout.write(
		`${colors.dim}  booting the project in production mode…${colors.reset}\n`
	);
	const app = await startProject({
		configPath,
		mode: 'production',
		projectRoot: process.cwd(),
		serverEntry
	});
	const throughput: Record<string, ThroughputResult> = {};
	/* One page at a time on purpose: two load tests at once would contend
	 * for the same server and the same CPU, and neither number would mean
	 * anything. */
	const measureOne = async (page: BenchPage) => {
		const { samples, windowMs } = await measureThroughput(
			`${app.baseUrl}${page.path}`,
			{ concurrency, durationMs, warmupMs }
		);
		throughput[page.label] = summarizeThroughput(samples, windowMs);
	};
	try {
		for (const page of pages)
			/* eslint-disable-next-line no-await-in-loop -- see above. */
			await measureOne(page);
	} finally {
		await app.kill().catch(() => undefined);
	}

	return throughput;
};

const readBaseline = (cwd: string) => {
	const path = join(cwd, BASELINE_FILE);
	if (!existsSync(path)) return null;
	try {
		const parsed: BenchRecord = JSON.parse(readFileSync(path, 'utf-8'));

		return parsed;
	} catch {
		return null;
	}
};

const printRecord = (record: BenchRecord) => {
	const lines: string[] = [];
	lines.push(`\n  ${colors.bold}sizes by framework${colors.reset}`);
	for (const [name, bytes] of Object.entries(record.sizes).sort(
		([, left], [, right]) => right - left
	))
		lines.push(
			`    ${name.padEnd(LABEL_WIDTH)}${colors.dim}${formatBytes(bytes)}${colors.reset}`
		);

	if (record.buildMs !== undefined) {
		/* The per-framework rows are sums of that framework's trace
		 * phases, and the build runs several passes in parallel, so they
		 * legitimately add up to more than the total. Saying so beats
		 * having someone discover it and distrust the whole report. */
		lines.push(
			`\n  ${colors.bold}build${colors.reset} ${colors.dim}· per-framework phases overlap, so they do not sum to the total${colors.reset}`
		);
		lines.push(
			`    ${'total'.padEnd(LABEL_WIDTH)}${colors.dim}${getDurationString(record.buildMs)}${colors.reset}`
		);
		for (const [name, total] of Object.entries(
			record.buildMsByFramework ?? {}
		).sort(([, left], [, right]) => right - left))
			lines.push(
				`    ${name.padEnd(LABEL_WIDTH)}${colors.dim}${getDurationString(total)}${colors.reset}`
			);
	}

	if (record.throughput !== undefined) {
		lines.push(
			`\n  ${colors.bold}render throughput${colors.reset} ${colors.dim}· machine-dependent${colors.reset}`
		);
		for (const [label, result] of Object.entries(record.throughput))
			lines.push(
				`    ${label.padEnd(LABEL_WIDTH)}${colors.dim}${result.rps} req/s · p50 ${result.p50?.toFixed(1) ?? '—'}ms · p99 ${result.p99?.toFixed(1) ?? '—'}ms${result.errors > 0 ? ` · ${colors.red}${result.errors} failed${colors.reset}` : ''}${colors.reset}`
			);
	}

	process.stdout.write(`${lines.join('\n')}\n`);
};

const describe = (regression: Regression) => {
	if (regression.kind === 'size')
		return `${regression.subject} ${formatBytes(regression.current)}, was ${formatBytes(regression.baseline)}`;
	if (regression.kind === 'time')
		return `${regression.subject} ${getDurationString(regression.current)}, was ${getDurationString(regression.baseline)}`;

	/* Rounded: a hand-edited or arithmetic-derived baseline can carry
	 * float noise, and `was 86190.29999999999` reads as a bug in the
	 * tool rather than a number someone typed. */
	return `${regression.subject} ${regression.current.toFixed(1)} req/s, was ${regression.baseline.toFixed(1)}`;
};

export const runBench = async (args: string[]) => {
	const cwd = process.cwd();
	const configPath = flagValue(args, '--config');
	const config = await loadConfig(configPath);
	const bench = config.bench ?? {};
	const outdir = resolve(
		cwd,
		flagValue(args, '--outdir') ?? config.buildDirectory ?? 'build'
	);

	const runs = Math.max(1, bench.runs ?? DEFAULT_RUNS);
	const durations: number[] = [];
	for (let run = 0; run < runs; run += 1) {
		process.stdout.write(
			`${colors.dim}  build ${run + 1} of ${runs}…${colors.reset}\n`
		);
		/* eslint-disable-next-line no-await-in-loop -- sequential by
		 * design: two builds at once would measure contention. */
		durations.push(await runBuildOnce(configPath, outdir));
	}

	const manifestPath = join(outdir, 'manifest.json');
	if (!existsSync(manifestPath))
		throw new Error(
			`The build wrote no manifest at ${manifestPath}, so there is nothing to measure.`
		);
	const manifest: Record<string, string> = JSON.parse(
		readFileSync(manifestPath, 'utf-8')
	);

	const record: BenchRecord = {
		buildMs: Math.round(median(durations) ?? 0),
		buildMsByFramework: buildTimeByFramework(outdir),
		recordedAt: new Date().toISOString(),
		sizes: sizesByFramework({
			manifest,
			sizeOf: (assetPath) => sizeOf(resolveAsset(outdir, assetPath))
		}),
		throughput: await measurePages({
			concurrency: bench.concurrency ?? DEFAULT_CONCURRENCY,
			configPath,
			durationMs: bench.durationMs ?? DEFAULT_DURATION_MS,
			pages: bench.pages ?? [],
			serverEntry: bench.serverEntry,
			warmupMs: bench.warmupMs ?? DEFAULT_WARMUP_MS
		})
	};

	if (args.includes('--json')) {
		process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

		return;
	}

	if (args.includes('--save')) {
		writeFileSync(
			join(cwd, BASELINE_FILE),
			`${JSON.stringify(record, null, 2)}\n`
		);
		printRecord(record);
		process.stdout.write(
			`\n  ${colors.green}✓${colors.reset} Saved to ${BASELINE_FILE}. Commit it, or the gate has nothing to compare against.\n`
		);

		return;
	}

	printRecord(record);

	if (!args.includes('--check')) return;

	const baseline = readBaseline(cwd);
	if (baseline === null) {
		process.stdout.write(
			`\n  ${colors.dim}No baseline yet — run \`absolute bench --save\` and commit ${BASELINE_FILE}.${colors.reset}\n`
		);

		return;
	}

	const regressions = compareRecords(baseline, record, {
		sizeTolerance: bench.sizeTolerance,
		timeTolerance: bench.timeTolerance
	});
	if (regressions.length === 0) {
		process.stdout.write(
			`\n  ${colors.green}✓${colors.reset} Nothing regressed beyond its tolerance ${colors.dim}(baseline ${baseline.recordedAt})${colors.reset}\n`
		);

		return;
	}
	for (const regression of regressions)
		process.stdout.write(
			`  ${colors.red}✗${colors.reset} ${describe(regression)} ${colors.dim}· tolerance ${regression.tolerance}×${colors.reset}\n`
		);
	process.exitCode = 1;
};
