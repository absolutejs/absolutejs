import { describe, expect, test, afterEach } from 'bun:test';
import {
	mkdtempSync,
	writeFileSync,
	rmSync,
	readFileSync,
	renameSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getAvailablePort } from '../../../helpers/ports';
import { waitForServer } from '../../../helpers/http';

let tmpDir: string | undefined;
let proc: ReturnType<typeof Bun.spawn> | undefined;

afterEach(async () => {
	if (proc) {
		try {
			proc.kill();
		} catch {
			/* already dead */
		}
		await proc.exited;
		proc = undefined;
	}
	if (tmpDir) {
		rmSync(tmpDir, { force: true, recursive: true });
		tmpDir = undefined;
	}
});

const spawnEntry = async (entryPath: string, port: number, hot: boolean) => {
	const argv = hot
		? ['bun', '--hot', '--no-clear-screen', entryPath]
		: ['bun', entryPath];
	const p = Bun.spawn(argv, {
		cwd: resolve(entryPath, '..'),
		env: { ...process.env, FORCE_COLOR: '0' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	await waitForServer(`http://localhost:${port}`);

	return p;
};

const writeEntryScript = (entryPath: string, port: number, sentinel: string) =>
	writeFileSync(
		entryPath,
		`import { createRequire } from 'node:module';\n` +
			`export const SENTINEL = '${sentinel}';\n` +
			`const require_ = createRequire(import.meta.url);\n` +
			// Re-import guard: re-importing the entry would otherwise
			// re-run Bun.serve and bind the same port twice.
			`if (!(globalThis as any).__entrySentinelServerStarted) {\n` +
			`\t(globalThis as any).__entrySentinelServerStarted = true;\n` +
			`\tBun.serve({\n` +
			`\t\tport: ${port},\n` +
			`\t\tfetch: async () => {\n` +
			`\t\t\ttry {\n` +
			`\t\t\t\tdelete require_.cache[${JSON.stringify(entryPath)}];\n` +
			`\t\t\t\tconst m = await import(${JSON.stringify(entryPath)});\n` +
			`\t\t\t\treturn new Response(String(m.SENTINEL));\n` +
			`\t\t\t} catch (err) {\n` +
			`\t\t\t\treturn new Response(\n` +
			`\t\t\t\t\t'REIMPORT_THREW:' + (err instanceof Error ? err.message : String(err)),\n` +
			`\t\t\t\t\t{ status: 500 }\n` +
			`\t\t\t\t);\n` +
			`\t\t\t}\n` +
			`\t\t}\n` +
			`\t});\n` +
			`}\n`,
		'utf-8'
	);

const atomicRenameSentinel = (entryPath: string, from: string, to: string) => {
	const current = readFileSync(entryPath, 'utf-8');
	const tmpPath = `${entryPath  }.tmp`;
	writeFileSync(
		tmpPath,
		current.replace(`SENTINEL = '${from}'`, `SENTINEL = '${to}'`),
		'utf-8'
	);
	renameSync(tmpPath, entryPath);
};

/* The serverEntryWatcher.ts workaround (sibling-copy Path B) was
 * introduced for oven-sh/bun#30447 / oven-sh/bun#30449 — the natural
 * pattern
 *
 *     delete createRequire(import.meta.url).cache[entryPath];
 *     await import(entryPath);
 *
 * threw "Requested module is not instantiated yet" under
 * `bun --hot` 1.3.13 and earlier, and on 1.3.14 was reported to
 * read stale source bytes after atomic-rename writes to the entry.
 *
 * This file is a behavioral SNAPSHOT against the current Bun
 * version, not a regression test on the workaround itself. It
 * locks in what plain `bun` vs `bun --hot` actually do today
 * after an atomic-rename edit followed by the natural
 * `delete + await import` invalidation pattern:
 *
 *   - Plain `bun`: returns FRESH bytes (V1). This is the
 *     documented baseline — the natural pattern has always
 *     worked off-hot.
 *   - `bun --hot`: also returns FRESH bytes (V1) on this Bun
 *     version. Under the original bug, this would have been V0.
 *
 * If the `--hot` row starts returning V0 instead, the bug has
 * regressed (or our toy entry isn't large enough to hit
 * `--hot`'s entry-pin path) and the sibling-copy workaround in
 * `serverEntryWatcher.ts` is load-bearing again. If both rows
 * stay at V1, a maintainer can investigate whether the workaround
 * is still needed in the *real* AbsoluteJS server entry (which
 * has many more imports and side effects than this minimal
 * script — Bun's `--hot` entry-pin behavior may depend on
 * module complexity).
 *
 * Either way, this test forces an explicit decision on changes
 * to Bun's --hot entry-reload semantics rather than letting them
 * pass silently. */
describe('bun#30449 natural-pattern sentinel (workaround tripwire)', () => {
	test('plain `bun` (no --hot): natural pattern returns fresh bytes after atomic-rename', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'absolutejs-bun-30449-plain-'));
		const entryPath = resolve(tmpDir, 'entry.ts');
		const port = await getAvailablePort();
		writeEntryScript(entryPath, port, 'V0');
		proc = await spawnEntry(entryPath, port, false);

		expect(await (await fetch(`http://localhost:${port}`)).text()).toBe(
			'V0'
		);
		atomicRenameSentinel(entryPath, 'V0', 'V1');
		await new Promise((r) => setTimeout(r, 200));
		expect(await (await fetch(`http://localhost:${port}`)).text()).toBe(
			'V1'
		);
	}, 30_000);

	test('`bun --hot`: natural pattern currently returns fresh bytes after atomic-rename (snapshot — see header)', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'absolutejs-bun-30449-hot-'));
		const entryPath = resolve(tmpDir, 'entry.ts');
		const port = await getAvailablePort();
		writeEntryScript(entryPath, port, 'V0');
		proc = await spawnEntry(entryPath, port, true);

		expect(await (await fetch(`http://localhost:${port}`)).text()).toBe(
			'V0'
		);
		atomicRenameSentinel(entryPath, 'V0', 'V1');
		await new Promise((r) => setTimeout(r, 500));
		const after = await (await fetch(`http://localhost:${port}`)).text();

		// Snapshot of current --hot behavior on this Bun version.
		// If this flips to 'V0', see the file header — the
		// sibling-copy workaround in serverEntryWatcher.ts is
		// load-bearing. If it stays at 'V1', the workaround may
		// be removable, but verify against the real AbsoluteJS
		// server entry before deleting it.
		expect(after).toBe('V1');
	}, 30_000);
});
