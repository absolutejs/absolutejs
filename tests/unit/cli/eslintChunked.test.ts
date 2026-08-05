import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	gitChangedFiles,
	gitVisibleFiles,
	parseChunkedArgs,
	ruleSummary,
	upstreamRef
} from '../../../src/cli/scripts/eslintChunked';

const temporaryDirectories: string[] = [];

afterEach(async () => {
	const { rm } = await import('node:fs/promises');
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { force: true, recursive: true });
	}
});

const git = (cwd: string, args: string[]) => {
	const proc = Bun.spawnSync(['git', ...args], { cwd });
	if (proc.exitCode !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed: ${proc.stderr.toString()}`
		);
	}
};

const gitRepo = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-lint-chunked-'));
	temporaryDirectories.push(directory);
	git(directory, ['init', '--initial-branch=main']);
	git(directory, ['config', 'user.email', 'test@absolutejs.dev']);
	git(directory, ['config', 'user.name', 'Test']);

	return directory;
};

describe('parseChunkedArgs', () => {
	test('separates runner flags, eslint passthrough, and glob positionals', () => {
		const parsed = parseChunkedArgs([
			'--chunked',
			'--changed=origin/dev',
			'--out',
			'report.txt',
			'--chunk-size',
			'10',
			'--shards',
			'8',
			'--fix',
			'src/**/*.ts'
		]);

		expect(parsed.changedOnly).toBe(true);
		expect(parsed.changedBase).toBe('origin/dev');
		expect(parsed.outFile).toBe('report.txt');
		expect(parsed.chunkSize).toBe(10);
		expect(parsed.shards).toBe(8);
		expect(parsed.passthrough).toEqual(['--fix']);
		expect(parsed.globs).toEqual(['src/**/*.ts']);
	});

	test('bare --changed leaves the base to upstream resolution', () => {
		const parsed = parseChunkedArgs(['--chunked', '--changed']);

		expect(parsed.changedOnly).toBe(true);
		expect(parsed.changedBase).toBeNull();
	});
});

describe('gitChangedFiles', () => {
	test('keeps the first-sorted unstaged file — leading porcelain whitespace is significant', async () => {
		const repo = await gitRepo();
		// Alphabetically first, so its porcelain line is the FIRST line of
		// output — the line whose leading space a whole-output trim() once
		// ate, shifting the status prefix onto the path and silently
		// dropping the file from every --changed run.
		await writeFile(join(repo, 'aaa-first.ts'), 'export const one = 1;\n');
		await writeFile(join(repo, 'zzz-last.ts'), 'export const two = 2;\n');
		git(repo, ['add', '.']);
		git(repo, ['commit', '-m', 'seed']);
		await writeFile(
			join(repo, 'aaa-first.ts'),
			'export const one = 111;\n'
		);
		await writeFile(join(repo, 'zzz-last.ts'), 'export const two = 222;\n');

		const changed = gitChangedFiles(repo, null);

		expect(changed.has('aaa-first.ts')).toBe(true);
		expect(changed.has('zzz-last.ts')).toBe(true);
	});

	test('includes untracked files and rename targets', async () => {
		const repo = await gitRepo();
		await writeFile(join(repo, 'kept.ts'), 'export const kept = 1;\n');
		git(repo, ['add', '.']);
		git(repo, ['commit', '-m', 'seed']);
		await writeFile(join(repo, 'fresh.ts'), 'export const fresh = 1;\n');
		git(repo, ['mv', 'kept.ts', 'renamed.ts']);

		const changed = gitChangedFiles(repo, null);

		expect(changed.has('fresh.ts')).toBe(true);
		expect(changed.has('renamed.ts')).toBe(true);
	});
});

describe('gitVisibleFiles', () => {
	test('sees tracked and untracked files but respects .gitignore', async () => {
		const repo = await gitRepo();
		await writeFile(join(repo, '.gitignore'), 'ignored.ts\n');
		await writeFile(join(repo, 'tracked.ts'), 'export const a = 1;\n');
		git(repo, ['add', '.']);
		git(repo, ['commit', '-m', 'seed']);
		await writeFile(join(repo, 'untracked.ts'), 'export const b = 2;\n');
		await writeFile(join(repo, 'ignored.ts'), 'export const c = 3;\n');

		const visible = gitVisibleFiles(repo);

		expect(visible).toContain('tracked.ts');
		expect(visible).toContain('untracked.ts');
		expect(visible).not.toContain('ignored.ts');
	});
});

describe('upstreamRef', () => {
	test('returns null when no upstream is configured', async () => {
		const repo = await gitRepo();
		await writeFile(join(repo, 'seed.ts'), 'export const a = 1;\n');
		git(repo, ['add', '.']);
		git(repo, ['commit', '-m', 'seed']);

		expect(upstreamRef(repo)).toBeNull();
	});
});

describe('ruleSummary', () => {
	test('ranks rule ids by finding count', () => {
		const report = [
			'/repo/a.ts',
			'  1:1  error  Bad thing  absolute/max-depth-extended',
			'  2:1  error  Bad thing  absolute/max-depth-extended',
			'  3:1  warning  Odd thing  no-magic-numbers',
			''
		].join('\n');

		const summary = ruleSummary(report);

		expect(summary).toContain('BY RULE (3 problems):');
		expect(summary.indexOf('absolute/max-depth-extended')).toBeLessThan(
			summary.indexOf('no-magic-numbers')
		);
		expect(summary).toContain('2  absolute/max-depth-extended');
		expect(summary).toContain('1  no-magic-numbers');
	});
});
