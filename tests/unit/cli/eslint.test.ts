import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	buildEslintCommand,
	createEslintCacheFingerprint,
	getCacheLocation,
	prepareEslintCache
} from '../../../src/cli/scripts/eslint';

const temporaryDirectories: string[] = [];

const runEslint = async (cwd: string, args: string[]) => {
	const cacheLocation = '.absolutejs/eslint-cache';
	prepareEslintCache({ cacheLocation, cwd });
	const command = [
		resolve(process.cwd(), 'node_modules/.bin/eslint'),
		...buildEslintCommand(args, cacheLocation).slice(2)
	];
	const proc = Bun.spawn(command, { cwd, stderr: 'pipe', stdout: 'pipe' });
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	return { exitCode, output: `${stdout}${stderr}` };
};

const project = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'absolute-eslint-cache-'));
	temporaryDirectories.push(directory);
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({ devDependencies: { eslint: '10.0.3' } })
	);
	await writeFile(join(directory, 'bun.lock'), 'lock-v1');
	await mkdir(join(directory, 'node_modules', 'eslint'), { recursive: true });
	await writeFile(
		join(directory, 'node_modules', 'eslint', 'package.json'),
		JSON.stringify({ name: 'eslint', version: '10.0.3' })
	);
	await writeFile(
		join(directory, 'eslint.config.mjs'),
		'export default [{ rules: { eqeqeq: "error" } }];'
	);

	return directory;
};

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('ESLint cache contract', () => {
	test('keeps unchanged green and known-problem cache entries hot', async () => {
		const cwd = await project();
		const cacheLocation = '.absolutejs/eslint-cache';
		expect(prepareEslintCache({ cacheLocation, cwd })).toBeTrue();
		await writeFile(join(cwd, cacheLocation), 'cached-known-problem');
		expect(prepareEslintCache({ cacheLocation, cwd })).toBeFalse();
		expect(await readFile(join(cwd, cacheLocation), 'utf-8')).toBe(
			'cached-known-problem'
		);
		await writeFile(join(cwd, 'changed.ts'), 'const changed = true;');
		await writeFile(join(cwd, 'bun.lock'), 'unrelated-lock-change');
		expect(prepareEslintCache({ cacheLocation, cwd })).toBeFalse();
		expect(await readFile(join(cwd, cacheLocation), 'utf-8')).toBe(
			'cached-known-problem'
		);
	});

	test('invalidates only when configuration or the lint toolchain changes', async () => {
		const cwd = await project();
		const cacheLocation = '.absolutejs/eslint-cache';
		prepareEslintCache({ cacheLocation, cwd });
		await writeFile(join(cwd, cacheLocation), 'cached');
		await writeFile(
			join(cwd, 'node_modules', 'eslint', 'package.json'),
			JSON.stringify({ name: 'eslint', version: '10.0.4' })
		);
		expect(prepareEslintCache({ cacheLocation, cwd })).toBeTrue();
		expect(await Bun.file(join(cwd, cacheLocation)).exists()).toBeFalse();
		await writeFile(join(cwd, cacheLocation), 'cached-again');
		await writeFile(
			join(cwd, 'eslint.config.mjs'),
			'export default [{ rules: { eqeqeq: "off" } }];'
		);
		expect(prepareEslintCache({ cacheLocation, cwd })).toBeTrue();
		expect(await Bun.file(join(cwd, cacheLocation)).exists()).toBeFalse();
	});

	test('uses content checks and respects explicit cache controls', async () => {
		expect(buildEslintCommand([], '.absolutejs/eslint-cache')).toEqual([
			'bun',
			'eslint',
			'--cache',
			'--cache-location',
			'.absolutejs/eslint-cache',
			'--cache-strategy',
			'content',
			'.'
		]);
		expect(
			buildEslintCommand(
				[
					'--cache-location',
					'.cache/eslint/',
					'--cache-strategy=metadata',
					'src'
				],
				'.cache/eslint/'
			)
		).toEqual([
			'bun',
			'eslint',
			'--cache',
			'--cache-location',
			'.cache/eslint/',
			'--cache-strategy=metadata',
			'src'
		]);
		expect(buildEslintCommand(['--no-cache'], 'unused')).toEqual([
			'bun',
			'eslint',
			'--no-cache',
			'.'
		]);
		expect(getCacheLocation(['--cache-location=.cache/eslint/'])).toBe(
			'.cache/eslint/'
		);
	});

	test('replays unchanged failures and fully checks changed files', async () => {
		const cwd = await project();
		await writeFile(join(cwd, 'source.js'), 'const value = 1 == "1";\n');

		const first = await runEslint(cwd, ['source.js']);
		expect(first.exitCode).toBe(1);
		expect(first.output).toContain('eqeqeq');

		const unchanged = await runEslint(cwd, ['source.js']);
		expect(unchanged.exitCode).toBe(1);
		expect(unchanged.output).toContain('eqeqeq');

		await writeFile(
			join(cwd, 'source.js'),
			'const value = 1 === 1;\nconsole.log(value);\n'
		);
		const changed = await runEslint(cwd, ['source.js']);
		expect(changed.exitCode).toBe(0);
	});

	test('fingerprints direct installed lint package versions without source files', async () => {
		const cwd = await project();
		const first = createEslintCacheFingerprint(cwd);
		await writeFile(join(cwd, 'source.ts'), 'const source = 1;');
		expect(createEslintCacheFingerprint(cwd)).toBe(first);
	});
});
