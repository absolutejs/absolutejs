import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
	cachedCleanFiles,
	lintContextKey,
	markVerdictCache
} from '../../../src/cli/scripts/eslintCacheProbe';
import { eslintChunked } from '../../../src/cli/scripts/eslintChunked';
import {
	chunkSizeFor,
	type MemoryObservation
} from '../../../src/cli/scripts/eslintMemoryModel';

/* The chunked lint leaves out files whose clean verdict is already cached,
 * keeps one verdict per file across processes, and sizes chunks from the
 * memory earlier processes peaked at. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const temporaryDirectories: string[] = [];
const GB = 1024 * 1024 * 1024;

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

const git = (cwd: string, args: string[]) => {
	const proc = Bun.spawnSync(['git', ...args], { cwd });
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
};

/* A real project for ESLint: one rule, three files, this repository's
 * node_modules. */
const project = async (rule = '"error"') => {
	const cwd = await mkdtemp(join(tmpdir(), 'absolute-lint-cache-'));
	temporaryDirectories.push(cwd);
	git(cwd, ['init', '--quiet', '--initial-branch=main']);
	await symlink(join(repoRoot, 'node_modules'), join(cwd, 'node_modules'));
	await writeFile(join(cwd, '.gitignore'), 'node_modules\n.absolutejs\n');
	await writeFile(
		join(cwd, 'eslint.config.mjs'),
		`export default [{ files: ["**/*.js"], rules: { "no-var": ${rule} } }];\n`
	);
	for (const name of ['a', 'b', 'c'])
		await writeFile(join(cwd, `${name}.js`), `export const ${name} = 1;\n`);

	return cwd;
};

const runLint = async (cwd: string) => {
	const lines: string[] = [];
	const log = spyOn(console, 'log').mockImplementation((...parts) => {
		lines.push(parts.join(' '));
	});
	const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
	// A failed lint exits the process; here it ends the run instead.
	const exit = spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('lint failed');
	});
	const error = spyOn(console, 'error').mockImplementation(() => undefined);
	try {
		await eslintChunked(['--chunked', '*.js'], cwd).catch(() => undefined);
	} finally {
		log.mockRestore();
		write.mockRestore();
		exit.mockRestore();
		error.mockRestore();
	}

	return lines.find((line) => line.startsWith('Linting ')) ?? '';
};

const BOUNDS: Parameters<typeof chunkSizeFor>[3] = {
	initial: 50,
	max: 2000,
	min: 10
};
const MB = 1024 * 1024;

const ts = (files: number, peakBytes: number): MemoryObservation => ({
	files,
	kind: '.ts',
	peakBytes
});

describe('chunk size from peak memory', () => {
	test('starts at the initial size with nothing observed', () => {
		expect(chunkSizeFor([], '.ts', 3 * GB, BOUNDS)).toBe(50);
	});

	test('one size seen scales proportionally, within twice the largest', () => {
		expect(chunkSizeFor([ts(50, 2 * GB)], '.ts', 3 * GB, BOUNDS)).toBe(75);
		expect(chunkSizeFor([ts(50, GB / 2)], '.ts', 3 * GB, BOUNDS)).toBe(100);
	});

	test('two sizes give a line through the fixed cost, solved for the target', () => {
		// onSpark-like: 1.6 GB to build the program, 4 MB per file.
		const peak = (files: number) => 1.6 * GB + files * 4 * MB;
		const observations = [ts(200, peak(200)), ts(300, peak(300))];

		expect(chunkSizeFor(observations, '.ts', peak(450), BOUNDS)).toBe(450);
		// Never further than twice the largest chunk seen.
		expect(chunkSizeFor(observations, '.ts', peak(5000), BOUNDS)).toBe(600);
	});

	test('one odd chunk does not swing the line', () => {
		const peak = (files: number) => 1.6 * GB + files * 4 * MB;
		const observations = [
			ts(100, peak(100)),
			ts(150, peak(150)),
			ts(200, peak(200)),
			ts(250, peak(250)),
			ts(300, peak(300)),
			// A chunk that never built the program.
			ts(10, 0.3 * GB)
		];

		expect(chunkSizeFor(observations, '.ts', peak(450), BOUNDS)).toBe(450);
	});

	test('each kind of file has its own line', () => {
		const observations: MemoryObservation[] = [
			ts(100, 2 * GB),
			ts(200, 2.4 * GB),
			{ files: 10, kind: '.vue', peakBytes: 0.3 * GB },
			{ files: 150, kind: '.vue', peakBytes: 0.7 * GB }
		];

		// .ts: 1.6 GB plus 4 MB a file; .vue: far less, so only the
		// extrapolation limit (twice 150) holds it back.
		expect(chunkSizeFor(observations, '.ts', 2 * GB, BOUNDS)).toBe(100);
		expect(chunkSizeFor(observations, '.vue', 2 * GB, BOUNDS)).toBe(300);
		expect(chunkSizeFor(observations, '.mjs', 2 * GB, BOUNDS)).toBe(50);
	});

	test('a target below the fixed cost, or noise, stays within bounds', () => {
		expect(
			chunkSizeFor(
				[ts(100, 2 * GB), ts(200, 2.1 * GB)],
				'.ts',
				GB,
				BOUNDS
			)
		).toBe(10);
		// No positive slope: fall back to proportional from the heaviest.
		expect(
			chunkSizeFor(
				[ts(100, 2.2 * GB), ts(200, 2 * GB)],
				'.ts',
				3.3 * GB,
				BOUNDS
			)
		).toBe(150);
	});
});

describe('a cached verdict is trusted only when it still applies', () => {
	test('a second run lints nothing; a config change lints everything again', async () => {
		const cwd = await project();

		expect(await runLint(cwd)).toContain(
			'0 have a clean cached verdict, 3 to lint'
		);
		expect(await runLint(cwd)).toContain(
			'3 have a clean cached verdict, 0 to lint'
		);

		await writeFile(join(cwd, 'b.js'), 'export const b = 2;\n');
		expect(await runLint(cwd)).toContain(
			'2 have a clean cached verdict, 1 to lint'
		);

		await writeFile(
			join(cwd, 'eslint.config.mjs'),
			'export default [{ files: ["**/*.js"], rules: { "no-var": "warn" } }];\n'
		);
		expect(await runLint(cwd)).toContain(
			'0 have a clean cached verdict, 3 to lint'
		);
	}, 120_000);

	test('a file whose cached result failed is linted again, so its errors are reported', async () => {
		const cwd = await project();
		await writeFile(join(cwd, 'b.js'), 'var b = 1;\nexport { b };\n');

		expect(await runLint(cwd)).toContain(
			'0 have a clean cached verdict, 3 to lint'
		);
		expect(await runLint(cwd)).toContain(
			'2 have a clean cached verdict, 1 to lint'
		);
	}, 120_000);

	test('no marker, or one from another config or arguments, means no skipping', async () => {
		const cwd = await project();
		await runLint(cwd);
		const cache = '.absolutejs/eslint-cache-verdicts';
		const files = ['a.js', 'b.js', 'c.js'];
		const key = lintContextKey('digest', []);

		markVerdictCache(cache, key, cwd);
		// The control: with its own marker, the cache does vouch for them.
		expect(cachedCleanFiles(files, cache, key, cwd).size).toBe(3);
		expect(
			cachedCleanFiles(files, cache, lintContextKey('other', []), cwd)
				.size
		).toBe(0);
		expect(
			cachedCleanFiles(
				files,
				cache,
				lintContextKey('digest', ['--rule', 'x']),
				cwd
			).size
		).toBe(0);
		await rm(join(cwd, `${cache}.config`));
		expect(cachedCleanFiles(files, cache, key, cwd).size).toBe(0);
	}, 120_000);
});

describe('one verdict cache across processes', () => {
	test('a small change is one process, and earlier shard caches are removed', async () => {
		const cwd = await project();
		await mkdir(join(cwd, '.absolutejs'), { recursive: true });
		await writeFile(join(cwd, '.absolutejs/eslint-cache-shard-0'), '[]');
		await writeFile(
			join(cwd, '.absolutejs/eslint-cache-shard-0.config'),
			'x'
		);

		await runLint(cwd);
		expect(existsSync(join(cwd, '.absolutejs/eslint-cache-shard-0'))).toBe(
			false
		);
		expect(
			existsSync(join(cwd, '.absolutejs/eslint-cache-shard-0.config'))
		).toBe(false);

		await writeFile(join(cwd, 'a.js'), 'export const a = 2;\n');
		await writeFile(join(cwd, 'c.js'), 'export const c = 2;\n');
		const line = await runLint(cwd);
		expect(line).toContain('1 have a clean cached verdict, 2 to lint');
		expect(line).toContain('1 process at a time');
	}, 120_000);

	test('a file keeps only its newest verdict', async () => {
		const cwd = await project();
		await runLint(cwd);
		// Fails, then is fixed back to the content that once passed: the
		// failing verdict replaced the clean one, so it is linted again,
		// and once it passes it is skipped.
		await writeFile(join(cwd, 'b.js'), 'var b = 1;\nexport { b };\n');
		expect(await runLint(cwd)).toContain(
			'2 have a clean cached verdict, 1 to lint'
		);
		expect(await runLint(cwd)).toContain(
			'2 have a clean cached verdict, 1 to lint'
		);
		await writeFile(join(cwd, 'b.js'), 'export const b = 1;\n');
		expect(await runLint(cwd)).toContain(
			'2 have a clean cached verdict, 1 to lint'
		);
		expect(await runLint(cwd)).toContain(
			'3 have a clean cached verdict, 0 to lint'
		);
	}, 120_000);

	test('each finished process is remembered for sizing the next run', async () => {
		const cwd = await project();
		await runLint(cwd);
		const saved: unknown = JSON.parse(
			await readFile(
				join(cwd, '.absolutejs/eslint-cache-memory.json'),
				'utf-8'
			)
		);

		expect(saved).toEqual([
			{ files: 3, kind: '.js', peakBytes: expect.any(Number) }
		]);
	}, 120_000);
});
