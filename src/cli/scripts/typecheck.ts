import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import {
	getWorkspaceServices,
	isWorkspaceConfig,
	loadConfig,
	loadRawConfig
} from '../../utils/loadConfig';
import { ANSI_ESCAPE_CODE } from '../../constants';
import type {
	AbsoluteServiceConfig,
	ServiceConfig
} from '../../../types/build';

type CheckerResult = { name: string; exitCode: number; output: string };

const isCommandService = (service: ServiceConfig) =>
	service.kind === 'command' || Array.isArray(service.command);

const getTypecheckTargets = async (configPath?: string) => {
	const rawConfig = await loadRawConfig(configPath);
	if (!isWorkspaceConfig(rawConfig)) {
		return [await loadConfig(configPath)];
	}

	return Object.values(getWorkspaceServices(rawConfig)).filter(
		(service): service is AbsoluteServiceConfig =>
			!isCommandService(service)
	);
};

const run = async (name: string, command: string[]): Promise<CheckerResult> => {
	const proc = Bun.spawn(command, {
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const exitCode = await proc.exited;

	return { exitCode, name, output: (stdout + stderr).trim() };
};

const shellEscape = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const runShell = async (name: string, command: string) =>
	run(name, ['/bin/bash', '-lc', command]);

const findBin = (name: string) => {
	const local = resolve('node_modules', '.bin', name);

	return existsSync(local) ? local : null;
};

const ANSI_COLOR_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[[0-9;]*m`,
	'g'
);
const ANSI_PURPLE_REGEX = `${String.fromCharCode(ANSI_ESCAPE_CODE)}[35m`;
const ANSI_CYAN_REGEX = new RegExp(
	`^${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[36m|\\t`
);
const ANSI_TOKEN_END_REGEX = new RegExp(
	`${String.fromCharCode(ANSI_ESCAPE_CODE)}\\[3[69]m`
);

const stripAnsi = (str: string) => str.replace(ANSI_COLOR_REGEX, '');

const formatSvelteOutput = (output: string) => {
	const cwd = `${process.cwd()}/`;

	// Extract error count for summary
	const summaryMatch = stripAnsi(output).match(
		/svelte-check found (\d+) error/
	);
	const errorCount = summaryMatch ? parseInt(summaryMatch[1] ?? '0', 10) : 0;

	const formatted = output
		.split('\n')
		.filter((line) => {
			const plain = stripAnsi(line);

			return (
				!plain.startsWith('Loading svelte-check') &&
				!plain.startsWith('Getting Svelte') &&
				!plain.startsWith('====') &&
				!plain.startsWith('svelte-check found') &&
				!/^\d+ (START|COMPLETED)/.test(plain) &&
				plain.trim() !== ''
			);
		})
		.flatMap((line) => {
			// Strip cwd prefix
			const result = line.replaceAll(cwd, '');

			// Recolor file paths to match tsc/vue-tsc style (cyan file, yellow line:col)
			const plain = stripAnsi(result);
			const pathMatch = plain.match(/^(\S+\.svelte):(\d+:\d+)$/);
			if (pathMatch) {
				return [
					`\x1b[96m${pathMatch[1]}\x1b[0m:\x1b[93m${pathMatch[2]}\x1b[0m`
				];
			}

			// Convert purple-highlighted tokens to red underlines like tsc.
			// Only show the error line (with highlight) + underline, skip context lines.
			if (result.includes(ANSI_PURPLE_REGEX)) {
				const plainLine = stripAnsi(result);
				const before = stripAnsi(
					result.split(ANSI_PURPLE_REGEX)[0] ?? ''
				);
				const token = stripAnsi(
					(result.split(ANSI_PURPLE_REGEX)[1] ?? '').split(
						ANSI_TOKEN_END_REGEX
					)[0] ?? ''
				);
				if (!token) return [result];

				// Expand tabs to match terminal display
				const expanded = before.replace(/\t/g, '        ');
				const expandedLine = plainLine.replace(/\t/g, '        ');
				const underline = '~'.repeat(token.length);

				return [
					`\x1b[0m${expandedLine}`,
					`${' '.repeat(expanded.length)}\x1b[91m${underline}\x1b[0m`
				];
			}

			// Skip context lines (cyan code blocks surrounding the error line)
			if (
				ANSI_CYAN_REGEX.test(result) &&
				!result.includes('Error') &&
				!result.includes(ANSI_PURPLE_REGEX)
			) {
				return [];
			}

			return [result];
		})
		.join('\n');

	if (errorCount > 0) {
		const suffix = errorCount === 1 ? '' : 's';

		return `${formatted}\n\nFound ${errorCount} error${suffix}.`;
	}

	return formatted;
};

const TYPECHECK_EXCLUDE = [
	'../node_modules/**/*',
	'../**/.absolutejs/**/*',
	'../**/build/**/*',
	'../**/dist/**/*',
	'../**/generated/**/*'
];

const TYPECHECK_INCLUDE = [
	'../src/**/*',
	'../types/**/*',
	'../example/**/*',
	'../tests/**/*',
	'../test/**/*',
	'../scripts/**/*'
];

const buildVueTscCheck = (cacheDir: string) => {
	const vueTscBin = findBin('vue-tsc');
	if (!vueTscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m vue-tsc is required for Vue type checking. Install it: bun add -d vue-tsc'
		);
		process.exit(1);
	}

	const vueTsconfigPath = join(cacheDir, 'tsconfig.vue-check.json');

	return writeFile(
		vueTsconfigPath,
		JSON.stringify(
			{
				compilerOptions: {
					rootDir: '..'
				},
				exclude: TYPECHECK_EXCLUDE,
				extends: resolve('tsconfig.json'),
				include: TYPECHECK_INCLUDE
			},
			null,
			'\t'
		)
	).then(() =>
		run('vue-tsc', [
			vueTscBin,
			'--noEmit',
			'--project',
			resolve(vueTsconfigPath),
			'--incremental',
			'--tsBuildInfoFile',
			join(cacheDir, 'vue-tsc.tsbuildinfo'),
			'--pretty'
		])
	);
};

const buildAngularCheck = async (cacheDir: string, angularDir: string) => {
	const ngcBin = findBin('ngc');
	if (!ngcBin) {
		console.error(
			'\x1b[31m✗\x1b[0m @angular/compiler-cli is required for Angular type checking. Install it: bun add -d @angular/compiler-cli'
		);
		process.exit(1);
	}

	const angularTsconfigPath = join(cacheDir, 'tsconfig.angular-check.json');
	await writeFile(
		angularTsconfigPath,
		JSON.stringify(
			{
				angularCompilerOptions: {
					strictTemplates: true
				},
				compilerOptions: {
					noEmit: true,
					rootDir: '..'
				},
				exclude: TYPECHECK_EXCLUDE,
				extends: resolve('tsconfig.json'),
				include: [`../${angularDir}/**/*`]
			},
			null,
			'\t'
		)
	);

	return runShell(
		'ngc',
		`${shellEscape(ngcBin)} -p ${shellEscape(resolve(angularTsconfigPath))}`
	);
};

const buildTscCheck = (cacheDir: string) => {
	const tscBin = findBin('tsc');
	if (!tscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m typescript is required for type checking. Install it: bun add -d typescript'
		);
		process.exit(1);
	}

	const tscConfigPath = join(cacheDir, 'tsconfig.typecheck.json');

	return writeFile(
		tscConfigPath,
		JSON.stringify(
			{
				compilerOptions: {
					rootDir: '..'
				},
				exclude: TYPECHECK_EXCLUDE,
				extends: resolve('tsconfig.json'),
				include: TYPECHECK_INCLUDE
			},
			null,
			'\t'
		)
	).then(() =>
		run('tsc', [
			tscBin,
			'--noEmit',
			'--project',
			resolve(tscConfigPath),
			'--incremental',
			'--tsBuildInfoFile',
			join(cacheDir, 'tsc.tsbuildinfo'),
			'--pretty'
		])
	);
};

const buildSvelteCheck = async (cacheDir: string, svelteDir: string) => {
	const svelteBin = findBin('svelte-check');
	if (!svelteBin) {
		console.error(
			'\x1b[31m✗\x1b[0m svelte-check is required for Svelte type checking. Install it: bun add -d svelte-check'
		);
		process.exit(1);
	}

	const svelteTsconfigPath = join(cacheDir, 'tsconfig.svelte-check.json');
	await writeFile(
		svelteTsconfigPath,
		JSON.stringify(
			{
				extends: resolve('tsconfig.json'),
				include: [`../${svelteDir}/**/*`]
			},
			null,
			'\t'
		)
	);

	return run('svelte-check', [
		svelteBin,
		'--tsconfig',
		resolve(svelteTsconfigPath),
		'--threshold',
		'error',
		'--compiler-warnings',
		'css-unused-selector:ignore',
		'--output',
		'human-verbose',
		'--color'
	]);
};

export const typecheck = async (configPath?: string) => {
	const targets = await getTypecheckTargets(configPath);

	const hasAngular = targets.some((config) =>
		Boolean(config.angularDirectory)
	);
	const hasSvelte = targets.some((config) => Boolean(config.svelteDirectory));
	const hasVue = targets.some((config) => Boolean(config.vueDirectory));
	const svelteDirs = [
		...new Set(
			targets
				.map((config) => config.svelteDirectory)
				.filter(
					(dir): dir is string =>
						typeof dir === 'string' && dir.length > 0
				)
		)
	];
	const angularDirs = [
		...new Set(
			targets
				.map((config) => config.angularDirectory)
				.filter(
					(dir): dir is string =>
						typeof dir === 'string' && dir.length > 0
				)
		)
	];

	const cacheDir = '.absolutejs';
	await mkdir(cacheDir, { recursive: true });
	const checks: Promise<CheckerResult>[] = [];

	// vue-tsc is a superset of tsc — it checks .ts, .tsx, AND .vue files.
	// Any .ts file can import from .vue, so vue-tsc must check everything
	// when Vue is present. When Vue is absent, plain tsc suffices.
	checks.push(hasVue ? buildVueTscCheck(cacheDir) : buildTscCheck(cacheDir));

	// svelte-check scoped to the Svelte directory only
	for (const svelteDir of hasSvelte ? svelteDirs : []) {
		checks.push(buildSvelteCheck(cacheDir, svelteDir));
	}

	for (const angularDir of hasAngular ? angularDirs : []) {
		checks.push(buildAngularCheck(cacheDir, angularDir));
	}

	const results = await Promise.all(checks);
	const failed = results.filter((res) => res.exitCode !== 0);

	if (failed.length === 0) {
		console.log('\x1b[32m✓\x1b[0m Typecheck passed');

		return;
	}

	for (const result of failed) {
		console.error(`\n\x1b[31m[${result.name}]\x1b[0m`);
		const output =
			result.name === 'svelte-check'
				? formatSvelteOutput(result.output)
				: result.output;
		console.error(output);
	}
	console.error(
		`\n\x1b[31m✗\x1b[0m Typecheck failed: ${failed.map((res) => res.name).join(', ')}`
	);
	process.exit(1);
};
