import { promises as fs, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const wsUrl = process.env.HMR_BENCH_WS_URL ?? 'ws://localhost:4321/hmr';
const SAMPLE_COUNT = Number(process.env.HMR_BENCH_N ?? 100);
const WARMUP = Number(process.env.HMR_BENCH_WARMUP ?? 3);
const TIMEOUT_MS = Number(process.env.HMR_BENCH_TIMEOUT_MS ?? 3000);
const DEV_LOG = process.env.HMR_BENCH_DEV_LOG ?? resolvePath(HERE, 'dev.log');
const SIZE_LABEL = process.env.HMR_BENCH_SIZE ?? 'small';
const RESULTS_PATH = process.env.HMR_BENCH_RESULTS;

type WsMsg = { type: string; data?: Record<string, unknown> };

type EditCase = {
	name: string;
	file: string;
	expect:
		| 'angular:component-update'
		| 'angular:component-remount'
		| 'style-update';
	logRegex: RegExp;
	flips: Array<{ from: string; to: string }>;
};

const TIER0_RE =
	/\[ng-hmr\] tier-0 [^(]+\(server (\d+)ms: imports \d+\/resolve \d+\/compile (\d+);/;
const TIER1A_RE =
	/\[ng-hmr\] tier-1a remount [^(]+\(server (\d+)ms: imports \d+\/resolve \d+\/compile (\d+);/;
const cases: EditCase[] = [
	{
		expect: 'angular:component-update',
		file: resolvePath(HERE, 'angular/components/counter.component.ts'),
		flips: [
			{ from: 'this.count++;', to: 'this.count = this.count + 1;' },
			{ from: 'this.count = this.count + 1;', to: 'this.count++;' }
		],
		logRegex: TIER0_RE,
		name: 'body-edit (.ts method body)'
	},
	{
		expect: 'angular:component-update',
		file: resolvePath(HERE, 'angular/components/header.component.ts'),
		flips: [
			{ from: "subtitle = 'Run zero';", to: "subtitle = 'Run one';" },
			{ from: "subtitle = 'Run one';", to: "subtitle = 'Run zero';" }
		],
		logRegex: TIER0_RE,
		name: 'inline-template (template string in @Component)'
	},
	{
		expect: 'angular:component-update',
		file: resolvePath(HERE, 'angular/templates/counter.component.html'),
		flips: [
			{ from: 'count is ', to: 'count is now ' },
			{ from: 'count is now ', to: 'count is ' }
		],
		logRegex: TIER0_RE,
		name: 'html-template (external templateUrl)'
	},
	/* CSS case is omitted from the multi-size orchestrator. The
	 * framework-wide CSS HMR path's file-watcher behavior is
	 * environment-sensitive in this fixture directory: edits
	 * sometimes don't trigger broadcasts on the WS even though
	 * the file changes are observed by the dev server's
	 * watcher. We have separate measurements for the CSS path
	 * (~72 ms server / ~105 ms e2e) from earlier runs in a
	 * `/tmp/` fixture; the Angular surgical paths (Tier 0 / 1a)
	 * are what this bench focuses on. */
	{
		expect: 'angular:component-remount',
		file: resolvePath(HERE, 'angular/components/counter.component.ts'),
		flips: [
			{
				from: '@Input() initialCount: number = 0;',
				to: "@Input() initialCount: number = 0;\n\t@Input() label: string = '';"
			},
			{
				from: "@Input() initialCount: number = 0;\n\t@Input() label: string = '';",
				to: '@Input() initialCount: number = 0;'
			}
		],
		logRegex: TIER1A_RE,
		name: 'structural (add @Input → Tier 1a remount)'
	}
];

// Snapshot all files we'll touch so we can restore on exit.
const originals = new Map<string, string>();
for (const editCase of cases) {
	if (!originals.has(editCase.file)) {
		originals.set(editCase.file, await fs.readFile(editCase.file, 'utf8'));
	}
}

const restoreFile = async (file: string, content: string) => {
	try {
		await fs.writeFile(file, content);
	} catch {
		/* best-effort */
	}
};
const restoreAll = async () =>
	Promise.all(
		[...originals].map(([file, content]) => restoreFile(file, content))
	);

process.on('SIGINT', async () => {
	await restoreAll();
	process.exit(130);
});

const ws = new WebSocket(wsUrl);
const listeners: Array<(msg: WsMsg) => void> = [];
ws.addEventListener('message', (event) => {
	let data: WsMsg;
	try {
		if (typeof event.data !== 'string') return;
		data = JSON.parse(event.data);
	} catch {
		return;
	}
	for (const listener of listeners.slice()) listener(data);
});

await new Promise<void>((resolve, reject) => {
	const timeout = setTimeout(
		() => reject(new Error('ws connect timeout')),
		5000
	);
	ws.addEventListener('open', () => {
		clearTimeout(timeout);
		resolve();
	});
	ws.addEventListener('error', () => {
		clearTimeout(timeout);
		reject(new Error('WebSocket connection failed'));
	});
});

ws.send(JSON.stringify({ framework: 'angular', type: 'ready' }));

const waitFor = (predicate: (message: WsMsg) => boolean) =>
	new Promise((resolve, reject) => {
		const listener = (message: WsMsg) => {
			if (!predicate(message)) return;
			const listenerIndex = listeners.indexOf(listener);
			if (listenerIndex >= 0) listeners.splice(listenerIndex, 1);
			resolve(message);
		};
		listeners.push(listener);
		setTimeout(() => {
			const listenerIndex = listeners.indexOf(listener);
			if (listenerIndex >= 0) listeners.splice(listenerIndex, 1);
			reject(new Error('hmr message timeout'));
		}, TIMEOUT_MS);
	});

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g');
const readLogTailFrom = (offset: number) => {
	try {
		const buffer = readFileSync(DEV_LOG);

		return buffer.subarray(offset).toString('utf8').replace(ANSI_RE, '');
	} catch {
		return '';
	}
};

const fileSize = (path: string) => {
	try {
		return readFileSync(path).length;
	} catch {
		return 0;
	}
};

type Sample = { e2eMs: number; serverMs?: number };

const editOnce = async (
	file: string,
	from: string,
	replacement: string,
	expect: string,
	logRegex: RegExp
) => {
	const content = await fs.readFile(file, 'utf8');
	if (!content.includes(from)) {
		throw new Error(`marker not found: "${from.slice(0, 60)}…" in ${file}`);
	}
	const next = content.replace(from, replacement);
	if (next === content) throw new Error('replace was a no-op');

	const logSizeBefore = fileSize(DEV_LOG);
	const wait = waitFor((message) => message.type === expect);
	const start = performance.now();
	await fs.writeFile(file, next);
	await wait;
	const e2eMs = performance.now() - start;

	// Give the dev server a tick to flush its log line.
	await sleep(20);
	const tail = readLogTailFrom(logSizeBefore);
	const match = logRegex.exec(tail);
	const serverMs = match ? Number(match[1]) : undefined;

	return { e2eMs, serverMs };
};

const stats = (samples: number[]) => {
	const sorted = [...samples].sort((left, right) => left - right);
	const quantile = (percentile: number) =>
		sorted[
			Math.min(sorted.length - 1, Math.floor(percentile * sorted.length))
		];
	const sum = sorted.reduce((total, value) => total + value, 0);

	return {
		max: sorted[sorted.length - 1],
		mean: sum / sorted.length,
		min: sorted[0],
		n: sorted.length,
		p50: quantile(0.5),
		p95: quantile(0.95)
	};
};

const fmt = (value: number | undefined) =>
	value === undefined ? '—' : value.toFixed(1);

console.log(
	`HMR benchmark [${SIZE_LABEL}] — ${SAMPLE_COUNT} warm samples per case (+ ${WARMUP} warmup), 1 cold sample`
);
console.log('');

/* Cold sample: the very first edit after the dev server starts.
 * Captures the @angular/compiler import cost on first
 * `tryFastHmr` call, the first `parseTemplate` call, and any
 * lazy initialization in the AbsoluteJS dispatcher. Run on the
 * body-edit case (apply then immediately revert so warm samples
 * for the same case start from the file's original state). */
const [coldCase] = cases;
if (!coldCase) throw new Error('Benchmark requires at least one edit case');
const coldContent = readFileSync(coldCase.file, 'utf8');
const findColdFlip = () => {
	for (
		let flipIndex = coldCase.flips.length - 1;
		flipIndex >= 0;
		flipIndex--
	) {
		const flip = coldCase.flips[flipIndex];
		if (flip && coldContent.includes(flip.from)) return flip;
	}

	return null;
};
const coldFlip = findColdFlip();
let coldSample: Sample | null = null;
if (!coldFlip) {
	console.error(
		`  cold sample skipped: no flip matches contents of ${coldCase.file}`
	);
} else {
	try {
		coldSample = await editOnce(
			coldCase.file,
			coldFlip.from,
			coldFlip.to,
			coldCase.expect,
			coldCase.logRegex
		);
		// Revert so the warm body-edit case starts from the same state.
		await editOnce(
			coldCase.file,
			coldFlip.to,
			coldFlip.from,
			coldCase.expect,
			coldCase.logRegex
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`  cold sample error: ${message}`);
	}
}
console.log(`cold (first edit after dev server start)`);
console.log(
	`  end-to-end: ${coldSample ? coldSample.e2eMs.toFixed(1) : '—'} ms`
);
console.log(
	`  server:     ${coldSample?.serverMs !== undefined ? coldSample.serverMs.toFixed(1) : '—'} ms`
);
console.log('');

const summary: Array<{
	name: string;
	e2e: ReturnType<typeof stats>;
	server: ReturnType<typeof stats>;
}> = [];

for (const editCase of cases) {
	const e2eSamples: number[] = [];
	const serverSamples: number[] = [];
	/* Pick whichever flip's `from` is currently in the file.
	 * Iterate in reverse so longer, more specific patterns win
	 * over shorter prefixes when both substrings are present
	 * (e.g., "count is now " is a superset of "count is "). */
	const useFlip = () => {
		const content = readFileSync(editCase.file, 'utf8');
		for (
			let flipIndex = editCase.flips.length - 1;
			flipIndex >= 0;
			flipIndex--
		) {
			const flip = editCase.flips[flipIndex];
			if (flip && content.includes(flip.from)) return flip;
		}
		throw new Error(
			`no flip matches the current contents of ${editCase.file}`
		);
	};

	for (let sampleIndex = 0; sampleIndex < WARMUP; sampleIndex++) {
		const flip = useFlip();
		try {
			await editOnce(
				editCase.file,
				flip.from,
				flip.to,
				editCase.expect,
				editCase.logRegex
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(`  warmup error #${sampleIndex}: ${message}`);
		}
		await sleep(80);
	}
	for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
		const flip = useFlip();
		try {
			const sample = await editOnce(
				editCase.file,
				flip.from,
				flip.to,
				editCase.expect,
				editCase.logRegex
			);
			e2eSamples.push(sample.e2eMs);
			if (sample.serverMs !== undefined)
				serverSamples.push(sample.serverMs);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(`  error #${sampleIndex}: ${message}`);
		}
		await sleep(80);
	}
	const e2eStats = stats(e2eSamples);
	const serverStats = stats(serverSamples);
	summary.push({
		e2e: e2eStats,
		name: editCase.name,
		server: serverStats
	});

	console.log(`${editCase.name}`);
	console.log(
		`  end-to-end (file write → WS broadcast received): n=${e2eStats.n} min=${fmt(e2eStats.min)} p50=${fmt(e2eStats.p50)} mean=${fmt(e2eStats.mean)} p95=${fmt(e2eStats.p95)} max=${fmt(e2eStats.max)} ms`
	);
	console.log(
		`  server-side dispatch ([ng-hmr] log):              n=${serverStats.n} min=${fmt(serverStats.min)} p50=${fmt(serverStats.p50)} mean=${fmt(serverStats.mean)} p95=${fmt(serverStats.p95)} max=${fmt(serverStats.max)} ms`
	);
	console.log('');
}

console.log('--- summary table (median ms) ---');
console.log(`size: ${SIZE_LABEL}`);
console.log(
	`cold: e2e=${coldSample ? coldSample.e2eMs.toFixed(1) : '—'} server=${coldSample?.serverMs !== undefined ? coldSample.serverMs.toFixed(1) : '—'}`
);
console.log('case | e2e p50 | server p50');
for (const result of summary) {
	console.log(
		`${result.name} | ${fmt(result.e2e.p50)} | ${fmt(result.server.p50)}`
	);
}

if (RESULTS_PATH) {
	const output: {
		cases: typeof summary;
		cold: { e2eMs: number; serverMs: number | null } | null;
		size: string;
	} = {
		cases: summary.map((result) => ({
			e2e: result.e2e,
			name: result.name,
			server: result.server
		})),
		cold: coldSample
			? { e2eMs: coldSample.e2eMs, serverMs: coldSample.serverMs ?? null }
			: null,
		size: SIZE_LABEL
	};
	await fs.writeFile(RESULTS_PATH, JSON.stringify(output, null, 2));
}

await restoreAll();
ws.close();
process.exit(0);
