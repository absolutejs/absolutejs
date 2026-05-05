import { promises as fs, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const wsUrl = process.env.HMR_BENCH_WS_URL ?? 'ws://localhost:4321/hmr';
const N = Number(process.env.HMR_BENCH_N ?? 100);
const WARMUP = Number(process.env.HMR_BENCH_WARMUP ?? 3);
const TIMEOUT_MS = Number(process.env.HMR_BENCH_TIMEOUT_MS ?? 3000);
const DEV_LOG =
	process.env.HMR_BENCH_DEV_LOG ?? resolve(HERE, 'dev.log');
const SIZE_LABEL = process.env.HMR_BENCH_SIZE ?? 'small';
const RESULTS_PATH = process.env.HMR_BENCH_RESULTS;

type WsMsg = { type: string; data?: Record<string, unknown> };

type EditCase = {
	name: string;
	file: string;
	expect: 'angular:component-update' | 'angular:component-remount' | 'style-update';
	logRegex: RegExp;
	flips: Array<{ from: string; to: string }>;
};

const TIER0_RE =
	/\[ng-hmr\] tier-0 [^(]+\(server (\d+)ms: imports \d+\/resolve \d+\/compile (\d+);/;
const TIER1A_RE =
	/\[ng-hmr\] tier-1a remount [^(]+\(server (\d+)ms: imports \d+\/resolve \d+\/compile (\d+);/;
const CSS_RE = /\[hmr\] css update [^(]+\((\d+)ms\)/;

const cases: EditCase[] = [
	{
		expect: 'angular:component-update',
		file: resolve(HERE, 'angular/components/counter.component.ts'),
		flips: [
			{ from: 'this.count++;', to: 'this.count = this.count + 1;' },
			{ from: 'this.count = this.count + 1;', to: 'this.count++;' }
		],
		logRegex: TIER0_RE,
		name: 'body-edit (.ts method body)'
	},
	{
		expect: 'angular:component-update',
		file: resolve(HERE, 'angular/components/header.component.ts'),
		flips: [
			{ from: "subtitle = 'Run zero';", to: "subtitle = 'Run one';" },
			{ from: "subtitle = 'Run one';", to: "subtitle = 'Run zero';" }
		],
		logRegex: TIER0_RE,
		name: 'inline-template (template string in @Component)'
	},
	{
		expect: 'angular:component-update',
		file: resolve(HERE, 'angular/templates/counter.component.html'),
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
		file: resolve(HERE, 'angular/components/counter.component.ts'),
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
for (const c of cases) {
	if (!originals.has(c.file)) {
		originals.set(c.file, await fs.readFile(c.file, 'utf8'));
	}
}

const restoreAll = async () => {
	for (const [f, content] of originals) {
		try {
			await fs.writeFile(f, content);
		} catch {
			/* best-effort */
		}
	}
};

process.on('SIGINT', async () => {
	await restoreAll();
	process.exit(130);
});

const ws = new WebSocket(wsUrl);
const listeners: Array<(msg: WsMsg) => void> = [];
ws.addEventListener('message', (e) => {
	let data: WsMsg;
	try {
		data = JSON.parse(e.data as string);
	} catch {
		return;
	}
	for (const cb of listeners.slice()) cb(data);
});

await new Promise<void>((resolve, reject) => {
	const t = setTimeout(() => reject(new Error('ws connect timeout')), 5000);
	ws.addEventListener('open', () => {
		clearTimeout(t);
		resolve();
	});
	ws.addEventListener('error', (e) => {
		clearTimeout(t);
		reject(e as unknown as Error);
	});
});

ws.send(JSON.stringify({ type: 'ready', framework: 'angular' }));

const waitFor = (predicate: (m: WsMsg) => boolean): Promise<WsMsg> =>
	new Promise((resolve, reject) => {
		const cb = (msg: WsMsg) => {
			if (predicate(msg)) {
				const i = listeners.indexOf(cb);
				if (i >= 0) listeners.splice(i, 1);
				resolve(msg);
			}
		};
		listeners.push(cb);
		setTimeout(() => {
			const i = listeners.indexOf(cb);
			if (i >= 0) listeners.splice(i, 1);
			reject(new Error('hmr message timeout'));
		}, TIMEOUT_MS);
	});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const readLogTailFrom = (offset: number): string => {
	try {
		const buf = readFileSync(DEV_LOG);
		return buf.subarray(offset).toString('utf8').replace(ANSI_RE, '');
	} catch {
		return '';
	}
};

const fileSize = (path: string): number => {
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
	to: string,
	expect: string,
	re: RegExp
): Promise<Sample> => {
	const content = await fs.readFile(file, 'utf8');
	if (!content.includes(from)) {
		throw new Error(`marker not found: "${from.slice(0, 60)}…" in ${file}`);
	}
	const next = content.replace(from, to);
	if (next === content) throw new Error('replace was a no-op');

	const logSizeBefore = fileSize(DEV_LOG);
	const wait = waitFor((m) => m.type === expect);
	const start = performance.now();
	await fs.writeFile(file, next);
	await wait;
	const e2eMs = performance.now() - start;

	// Give the dev server a tick to flush its log line.
	await sleep(20);
	const tail = readLogTailFrom(logSizeBefore);
	const m = re.exec(tail);
	const serverMs = m ? Number(m[1]) : undefined;
	return { e2eMs, serverMs };
};

const stats = (xs: number[]) => {
	const sorted = [...xs].sort((a, b) => a - b);
	const q = (p: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
	const sum = sorted.reduce((a, b) => a + b, 0);
	return {
		n: sorted.length,
		min: sorted[0],
		p50: q(0.5),
		mean: sum / sorted.length,
		p95: q(0.95),
		max: sorted[sorted.length - 1]
	};
};

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(1));

console.log(
	`HMR benchmark [${SIZE_LABEL}] — ${N} warm samples per case (+ ${WARMUP} warmup), 1 cold sample`
);
console.log('');

/* Cold sample: the very first edit after the dev server starts.
 * Captures the @angular/compiler import cost on first
 * `tryFastHmr` call, the first `parseTemplate` call, and any
 * lazy initialization in the AbsoluteJS dispatcher. Run on the
 * body-edit case (apply then immediately revert so warm samples
 * for the same case start from the file's original state). */
const coldCase = cases[0];
const coldContent = readFileSync(coldCase.file, 'utf8');
const coldFlip = (() => {
	for (let i = coldCase.flips.length - 1; i >= 0; i--) {
		const f = coldCase.flips[i];
		if (coldContent.includes(f.from)) return f;
	}
	return null;
})();
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
	} catch (err) {
		console.error(`  cold sample error: ${(err as Error).message}`);
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

for (const c of cases) {
	const e2eSamples: number[] = [];
	const serverSamples: number[] = [];
	let flipIdx = 0;
	/* Pick whichever flip's `from` is currently in the file.
	 * Iterate in reverse so longer, more specific patterns win
	 * over shorter prefixes when both substrings are present
	 * (e.g., "count is now " is a superset of "count is "). */
	const useFlip = () => {
		flipIdx++;
		const content = readFileSync(c.file, 'utf8');
		for (let i = c.flips.length - 1; i >= 0; i--) {
			const f = c.flips[i];
			if (content.includes(f.from)) return f;
		}
		throw new Error(
			`no flip matches the current contents of ${c.file}`
		);
	};

	for (let i = 0; i < WARMUP; i++) {
		const f = useFlip();
		try {
			await editOnce(c.file, f.from, f.to, c.expect, c.logRegex);
		} catch (err) {
			console.error(`  warmup error #${i}: ${(err as Error).message}`);
		}
		await sleep(80);
	}
	for (let i = 0; i < N; i++) {
		const f = useFlip();
		try {
			const sample = await editOnce(
				c.file,
				f.from,
				f.to,
				c.expect,
				c.logRegex
			);
			e2eSamples.push(sample.e2eMs);
			if (sample.serverMs !== undefined) serverSamples.push(sample.serverMs);
		} catch (err) {
			console.error(`  error #${i}: ${(err as Error).message}`);
		}
		await sleep(80);
	}
	const e = stats(e2eSamples);
	const sv = stats(serverSamples);
	summary.push({ e2e: e, name: c.name, server: sv });

	console.log(`${c.name}`);
	console.log(
		`  end-to-end (file write → WS broadcast received): n=${e.n} min=${fmt(e.min)} p50=${fmt(e.p50)} mean=${fmt(e.mean)} p95=${fmt(e.p95)} max=${fmt(e.max)} ms`
	);
	console.log(
		`  server-side dispatch ([ng-hmr] log):              n=${sv.n} min=${fmt(sv.min)} p50=${fmt(sv.p50)} mean=${fmt(sv.mean)} p95=${fmt(sv.p95)} max=${fmt(sv.max)} ms`
	);
	console.log('');
}

console.log('--- summary table (median ms) ---');
console.log(`size: ${SIZE_LABEL}`);
console.log(
	`cold: e2e=${coldSample ? coldSample.e2eMs.toFixed(1) : '—'} server=${coldSample?.serverMs !== undefined ? coldSample.serverMs.toFixed(1) : '—'}`
);
console.log('case | e2e p50 | server p50');
for (const s of summary) {
	console.log(`${s.name} | ${fmt(s.e2e.p50)} | ${fmt(s.server.p50)}`);
}

if (RESULTS_PATH) {
	const out = {
		cases: summary.map((s) => ({
			e2e: s.e2e,
			name: s.name,
			server: s.server
		})),
		cold: coldSample
			? { e2eMs: coldSample.e2eMs, serverMs: coldSample.serverMs ?? null }
			: null,
		size: SIZE_LABEL
	};
	await fs.writeFile(RESULTS_PATH, JSON.stringify(out, null, 2));
}

await restoreAll();
ws.close();
process.exit(0);
