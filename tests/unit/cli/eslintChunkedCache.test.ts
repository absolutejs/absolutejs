import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import {
	cachedCleanFiles,
	lintContextKey,
	markShardCache
} from '../../../src/cli/scripts/eslintCacheProbe';
import {
	eslintChunked,
	nextChunkSize
} from '../../../src/cli/scripts/eslintChunked';

/* The chunked lint leaves out files whose clean verdict ESLint has already
 * cached, and sizes each chunk from the previous process's peak memory. */

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

describe('chunk size from peak memory', () => {
	test('grows toward the target, at most double per step', () => {
		expect(nextChunkSize(50, 0.5 * GB, 4 * GB)).toBe(100);
		expect(nextChunkSize(50, 2 * GB, 4 * GB)).toBe(60);
	});

	test('shrinks when a process ran hot, within bounds', () => {
		expect(nextChunkSize(100, 4 * GB, 4 * GB)).toBe(60);
		expect(nextChunkSize(12, 40 * GB, 4 * GB)).toBe(10);
		expect(nextChunkSize(400, 0.1 * GB, 4 * GB)).toBe(500);
	});

	test('keeps the size when the peak is unknown', () => {
		expect(nextChunkSize(50, undefined, 4 * GB)).toBe(50);
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
		const cache = '.absolutejs/eslint-cache-shard-0';
		const files = ['a.js', 'b.js', 'c.js'];
		const key = lintContextKey('digest', []);

		markShardCache(cache, key, cwd);
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
