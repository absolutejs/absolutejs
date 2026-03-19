import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4444;
const SERVER_ENTRY = 'example/server.ts';
const CONFIG_PATH = 'example/absolute.config.ts';

// ── Config ──
// Change these to control sample size. More rounds = more reliable averages.
const WARM_UP_ROUNDS = 3;
const BUILD_ROUNDS = 10;
const DEV_START_ROUNDS = 10;
const HMR_ROUNDS = 20;

const FRAMEWORKS = ['react', 'svelte', 'vue', 'angular', 'html', 'htmx'] as const;

const HMR_TARGETS: Record<string, { path: string; marker: string; replacement: (i: number) => string }> = {
	react: {
		path: 'example/react/pages/ReactExample.tsx',
		marker: '<App initialCount={initialCount} />',
		replacement: (i) => `<App initialCount={initialCount} /> {/* speed-test-${i} */}`
	},
	svelte: { path: 'example/svelte/pages/SvelteExample.svelte', marker: '', replacement: () => '' },
	vue: { path: 'example/vue/pages/VueExample.vue', marker: '', replacement: () => '' },
	angular: { path: 'example/angular/pages/angular-example.ts', marker: '', replacement: () => '' },
	html: { path: 'example/html/pages/HTMLExample.html', marker: '', replacement: () => '' },
	htmx: { path: 'example/htmx/pages/HTMXExample.html', marker: '', replacement: () => '' }
};

// ── Helpers ──

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const fmtMs = (n: number) => `${n.toFixed(0)}ms`;
const pad = (s: string, len: number) => s.padEnd(len);
const sleep = (t: number) => new Promise<void>((r) => setTimeout(r, t));

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
const p50 = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const p95 = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * 0.95)];
const minVal = (arr: number[]) => Math.min(...arr);
const maxVal = (arr: number[]) => Math.max(...arr);

const log = (msg: string) => console.log(`  ${msg}`);
const header = (msg: string) => console.log(`\n${bold(cyan(`▸ ${msg}`))}`);
const separator = () => console.log(dim('─'.repeat(72)));

// ── Types ──

type HmrTiming = { total: number; detection: number; build: number };
type HmrFrameworkResult = { cold: HmrTiming[]; warm: HmrTiming[] };
type DevStartTiming = { total: number; boot: number; build: number };

const UPDATE_TYPES = new Set([
	'react-update', 'svelte-update', 'vue-update', 'angular-update',
	'html-update', 'htmx-update', 'full-reload', 'module-update', 'script-update'
]);

// ── Detect HMR markers from actual files ──

const initHmrTargets = () => {
	for (const [fw, target] of Object.entries(HMR_TARGETS)) {
		if (target.marker) continue;
		const content = readFileSync(resolve(target.path), 'utf-8');
		const lines = content.split('\n');

		const searchTerms: Record<string, string[]> = {
			svelte: ['<h1', '<main'],
			vue: ['<h1', '<template'],
			angular: ['template:', 'templateUrl'],
			html: ['<title', '<h1'],
			htmx: ['<title', '<h1']
		};

		const terms = searchTerms[fw];
		if (!terms) continue;
		const idx = lines.findIndex((l) => terms.some((t) => l.includes(t)));
		if (idx === -1) continue;

		target.marker = lines[idx];
		target.replacement = fw === 'angular'
			? (i) => `${lines[idx]} // speed-test-${i}`
			: (i) => `${lines[idx]}<!-- speed-test-${i} -->`;
	}
};

const killPort = async (port: number) => {
	try {
		const proc = Bun.spawn(['lsof', '-i', `:${port}`, '-t'], { stdout: 'pipe', stderr: 'pipe' });
		const text = await new Response(proc.stdout).text();
		const pids = text.trim().split('\n').filter(Boolean);
		for (const pid of pids) {
			try { process.kill(parseInt(pid), 'SIGKILL'); } catch { /* already dead */ }
		}
		if (pids.length) await sleep(500);
	} catch { /* lsof not found or no processes */ }
};

// ── Build speed ──

const measureBuild = async () => {
	header('Build (production bundle)');
	const times: number[] = [];

	for (let i = 0; i < BUILD_ROUNDS; i++) {
		const start = performance.now();
		const proc = Bun.spawn(
			['bun', 'run', 'src/cli/index.ts', 'start', SERVER_ENTRY, '--outdir', 'example/dist', '--config', CONFIG_PATH],
			{
				cwd: process.cwd(),
				env: { ...process.env, TELEMETRY_OFF: '1', NODE_ENV: 'production', PORT: String(PORT + 100) },
				stdout: 'pipe', stderr: 'pipe'
			}
		);

		const reader = proc.stdout.getReader();
		let ready = false;
		while (!ready) {
			const { done, value } = await reader.read();
			if (done) break;
			if (Buffer.from(value).toString().includes('Local:')) ready = true;
		}
		const elapsed = performance.now() - start;
		proc.kill();
		await proc.exited;
		times.push(elapsed);
		log(`  run ${i + 1}/${BUILD_ROUNDS}: ${fmtMs(elapsed)}`);
	}

	return times;
};

// ── Dev server start ──

const measureDevStart = async () => {
	header('Dev server cold start');
	const timings: DevStartTiming[] = [];

	for (let i = 0; i < DEV_START_ROUNDS; i++) {
		await killPort(PORT);
		const start = performance.now();
		let reportedBuildMs = 0;

		const proc = Bun.spawn(
			['bun', '--hot', '--no-clear-screen', SERVER_ENTRY],
			{
				cwd: process.cwd(),
				env: {
					...process.env, TELEMETRY_OFF: '1', NODE_ENV: 'development',
					PORT: String(PORT), ABSOLUTE_CONFIG: CONFIG_PATH
				},
				stdout: 'pipe', stderr: 'pipe', stdin: 'ignore'
			}
		);

		const reader = proc.stdout.getReader();
		let ready = false;
		while (!ready) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value).toString().replace(/\x1b\[[0-9;]*m/g, '');
			const m = chunk.match(/ready in\s+(?:(\d+(?:\.\d+)?)s|(\d+)ms)/);
			if (m) reportedBuildMs = m[1] ? parseFloat(m[1]) * 1000 : parseInt(m[2], 10);
			if (chunk.includes('Local:')) ready = true;
		}
		const total = performance.now() - start;
		proc.kill();
		await proc.exited;

		const build = reportedBuildMs || total;
		const boot = total - build;
		timings.push({ total, boot: Math.max(0, boot), build });
		log(`  run ${i + 1}/${DEV_START_ROUNDS}: ${fmtMs(total)} ${dim(`(boot ${fmtMs(Math.max(0, boot))} + build ${fmtMs(build)})`)}`);
	}

	return timings;
};

// ── HMR measurement ──

const connectWs = (port: number) =>
	new Promise<WebSocket>((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${port}/hmr`);
		const timer = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 10_000);
		ws.onopen = () => { clearTimeout(timer); ws.send(JSON.stringify({ type: 'ready', framework: 'react' })); resolve(ws); };
		ws.onerror = () => { clearTimeout(timer); reject(new Error('WS failed')); };
	});

// Wait for one complete HMR rebuild cycle. Resolves with timing breakdown.
// fileWriteTime should be set to performance.now() right before writing the file.
const waitForRebuild = (ws: WebSocket, fileWriteTime: number, timeoutMs = 15_000) =>
	new Promise<HmrTiming>((resolve, reject) => {
		let rebuildStartAt = 0;
		let doneAt = 0;

		const timer = setTimeout(() => {
			ws.removeEventListener('message', onMsg);
			reject(new Error('HMR timeout'));
		}, timeoutMs);

		const onMsg = (event: MessageEvent) => {
			const now = performance.now();
			const data = JSON.parse(String(event.data));

			if (data.type === 'rebuild-start' && !rebuildStartAt) {
				rebuildStartAt = now;
			}

			// Fast paths: rebuild-start → framework-update (no rebuild-complete)
			// Full rebuilds: rebuild-start → rebuild-complete → framework-updates
			// Either way, the first update/complete after rebuild-start marks the end.
			if (rebuildStartAt && (UPDATE_TYPES.has(data.type) || data.type === 'rebuild-complete')) {
				if (!doneAt) {
					doneAt = now;
					clearTimeout(timer);
					ws.removeEventListener('message', onMsg);
					resolve({
						total: doneAt - fileWriteTime,
						detection: rebuildStartAt - fileWriteTime,
						build: doneAt - rebuildStartAt
					});
				}
			}
		};

		ws.addEventListener('message', onMsg);
	});

const measureHmr = async () => {
	header('HMR (hot module replacement)');

	await killPort(PORT);
	log('Starting dev server...');
	const proc = Bun.spawn(
		['bun', '--hot', '--no-clear-screen', SERVER_ENTRY],
		{
			cwd: process.cwd(),
			env: {
				...process.env, TELEMETRY_OFF: '1', NODE_ENV: 'development',
				PORT: String(PORT), ABSOLUTE_CONFIG: CONFIG_PATH
			},
			stdout: 'pipe', stderr: 'pipe', stdin: 'ignore'
		}
	);

	const reader = proc.stdout.getReader();
	let serverReady = false;
	while (!serverReady) {
		const { done, value } = await reader.read();
		if (done) break;
		if (Buffer.from(value).toString().includes('Local:')) serverReady = true;
	}

	if (!serverReady) {
		log(red('Dev server failed to start'));
		proc.kill(); await proc.exited;
		return {};
	}

	log(green('Dev server ready'));
	await sleep(500);

	let ws: WebSocket;
	try {
		ws = await connectWs(PORT);
		log(green('WebSocket connected'));
	} catch {
		log(red('Failed to connect WebSocket'));
		proc.kill(); await proc.exited;
		return {};
	}

	await sleep(800);

	const results: Record<string, HmrFrameworkResult> = {};

	for (const fw of FRAMEWORKS) {
		const target = HMR_TARGETS[fw];
		if (!target.marker) {
			log(yellow(`  ${fw}: skipped (no marker found)`));
			continue;
		}

		const originalContent = readFileSync(resolve(target.path), 'utf-8');
		const coldTimings: HmrTiming[] = [];
		const warmTimings: HmrTiming[] = [];

		log(dim(`  ${fw}: ${WARM_UP_ROUNDS} warm-up + ${HMR_ROUNDS} measured...`));

		const totalRounds = WARM_UP_ROUNDS + HMR_ROUNDS;

		for (let i = 0; i < totalRounds; i++) {
			const isWarmUp = i < WARM_UP_ROUNDS;

			try {
				// ── Modify file ──
				const modifiedContent = originalContent.replace(
					target.marker,
					target.replacement(Date.now())
				);
				const writeTime = performance.now();
				writeFileSync(resolve(target.path), modifiedContent);
				const timing = await waitForRebuild(ws, writeTime);

				// ── Restore file and wait for that rebuild too ──
				const restoreTime = performance.now();
				writeFileSync(resolve(target.path), originalContent);
				await waitForRebuild(ws, restoreTime);
				await sleep(80);

				if (!isWarmUp) {
					if (coldTimings.length === 0) {
						coldTimings.push(timing);
					} else {
						warmTimings.push(timing);
					}
				}
			} catch {
				log(red(`    ${fw} round ${i}: timed out`));
				// Ensure file is restored
				writeFileSync(resolve(target.path), originalContent);
				await sleep(500);
			}
		}

		writeFileSync(resolve(target.path), originalContent);
		results[fw] = { cold: coldTimings, warm: warmTimings };

		if (coldTimings.length > 0 && warmTimings.length > 0) {
			log(`  ${fw} cold: ${fmtMs(coldTimings[0].total)} ${dim(`(detect ${fmtMs(coldTimings[0].detection)} + build ${fmtMs(coldTimings[0].build)})`)}`);
			log(`  ${fw} warm avg: ${fmtMs(avg(warmTimings.map((t) => t.total)))} ${dim(`(detect ${fmtMs(avg(warmTimings.map((t) => t.detection)))} + build ${fmtMs(avg(warmTimings.map((t) => t.build)))})`)}`);
		}
	}

	ws.close();
	proc.kill();
	await proc.exited;

	return results;
};

// ── Summary ──

const printSummary = (
	buildTimes: number[],
	devStartTimings: DevStartTiming[],
	hmrResults: Record<string, HmrFrameworkResult>
) => {
	console.log('\n');
	console.log(bold('╔════════════════════════════════════════════════════════════════════════╗'));
	console.log(bold('║                        SPEED TEST RESULTS                             ║'));
	console.log(bold('╚════════════════════════════════════════════════════════════════════════╝'));

	const row = (label: string, times: number[]) => {
		if (!times.length) return;
		console.log(
			`  ${pad(label, 28)} ${pad(fmtMs(avg(times)), 8)} ${pad(fmtMs(p50(times)), 8)} ${pad(fmtMs(p95(times)), 8)} ${pad(fmtMs(minVal(times)), 8)} ${fmtMs(maxVal(times))}`
		);
	};

	const headerRow = () => {
		console.log(bold(`  ${pad('Metric', 28)} ${pad('Avg', 8)} ${pad('p50', 8)} ${pad('p95', 8)} ${pad('Min', 8)} Max`));
	};

	separator();
	console.log(bold(magenta('  Production Build')));
	separator();
	headerRow();
	row('Total', buildTimes);

	separator();
	console.log(bold(magenta('  Dev Server Cold Start')));
	separator();
	headerRow();
	row('Total', devStartTimings.map((t) => t.total));
	row('  Bun boot (overhead)', devStartTimings.map((t) => t.boot));
	row('  Build + vendors', devStartTimings.map((t) => t.build));

	separator();
	console.log(bold(magenta('  HMR by Framework (warm)')));
	separator();
	headerRow();

	for (const fw of FRAMEWORKS) {
		const r = hmrResults[fw];
		if (!r?.warm?.length) continue;

		console.log(bold(`  ${fw}`));
		row('  Total (cold)', r.cold.map((t) => t.total));
		row('  Total (warm)', r.warm.map((t) => t.total));
		row('    Detection (fs→ws)', r.warm.map((t) => t.detection));
		row('    Build (compile+bundle)', r.warm.map((t) => t.build));
	}

	separator();
	console.log(bold(magenta('  Bottleneck Analysis')));
	separator();

	for (const fw of FRAMEWORKS) {
		const r = hmrResults[fw];
		if (!r?.warm?.length) continue;
		const warmTotal = avg(r.warm.map((t) => t.total));
		const warmDetect = avg(r.warm.map((t) => t.detection));
		const warmBuild = avg(r.warm.map((t) => t.build));
		const detectPct = ((warmDetect / warmTotal) * 100).toFixed(0);
		const buildPct = ((warmBuild / warmTotal) * 100).toFixed(0);

		const bottleneck = warmDetect >= warmBuild ? 'detection' : 'build';

		console.log(
			`  ${pad(fw, 12)} detect ${pad(detectPct + '%', 5)} build ${pad(buildPct + '%', 5)} ${dim(`bottleneck: ${bottleneck}`)}`
		);
	}

	separator();
	console.log('');
};

// ── Main ──

const main = async () => {
	console.log(bold(cyan('\n  AbsoluteJS Speed Test\n')));
	console.log(dim(`  Build: ${BUILD_ROUNDS} rounds | Dev start: ${DEV_START_ROUNDS} rounds | HMR: ${HMR_ROUNDS} rounds (+${WARM_UP_ROUNDS} warm-up)`));
	console.log(dim(`  Port: ${PORT}`));
	console.log('');

	initHmrTargets();

	const buildTimes = await measureBuild();
	const devStartTimings = await measureDevStart();
	const hmrResults = await measureHmr();

	printSummary(buildTimes, devStartTimings, hmrResults);
};

main().catch((err) => {
	console.error(red(`Speed test failed: ${err.message}`));
	process.exit(1);
});
