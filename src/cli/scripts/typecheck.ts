import { resolve, join, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import {
	getWorkspaceServices,
	isWorkspaceConfig,
	loadConfig,
	loadRawConfig
} from '../../utils/loadConfig';
import {
	deferrableEntryImports,
	formatImportAdvice,
	summarizeImportAdvice
} from '../../dev/importCost/advice';
import { getString, isRecord } from '../config/guards';
import { ANSI_ESCAPE_CODE } from '../../constants';
import { DEFAULT_SERVER_ENTRY } from '../utils';
import type {
	AbsoluteServiceConfig,
	ServiceConfig
} from '../../../types/build';

type CheckerResult = { name: string; exitCode: number; output: string };

const isCommandService = (service: ServiceConfig) =>
	service.kind === 'command' || Array.isArray(service.command);

const resolveConfigPath = (configPath?: string) =>
	resolve(configPath ?? process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts');

const getTypecheckTargets = async (configPath?: string) => {
	// The config is optional for typechecking. A plain TypeScript library or
	// published package is not an AbsoluteJS app — it has no frontend
	// directories to discover — but it should still be able to run
	// `absolute typecheck` (cached tsc, with vue-tsc/svelte-check/ngc layered
	// in only when a config declares those framework directories). With no
	// config present we fall back to a single framework-less target, so the
	// check is exactly `tsc --noEmit` over the project's tsconfig.
	if (!existsSync(resolveConfigPath(configPath))) {
		const defaultService: AbsoluteServiceConfig = {};

		return [defaultService];
	}

	const rawConfig = await loadRawConfig(configPath);
	if (!isWorkspaceConfig(rawConfig)) {
		return [await loadConfig(configPath)];
	}

	return Object.values(getWorkspaceServices(rawConfig)).filter(
		(service): service is AbsoluteServiceConfig =>
			!isCommandService(service)
	);
};

const STACK_OVERFLOW = 'Maximum call stack size exceeded';
/* Deep enough for the compilers' AST recursion on a large project, still
 * far below a typical 8 MB thread stack. */
const DEEP_STACK_KB = 4000;

const spawnChecker = async (
	name: string,
	command: string[]
): Promise<CheckerResult> => {
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

/**
 * Runs a checker, and retries it with a deeper stack if it blew the default
 * one. A stack overflow is never a type error: tsc, vue-tsc and ngc all walk
 * the syntax tree recursively, so a deeply nested expression can exhaust
 * node's ~1 MB default while the code is perfectly valid. Reporting that as
 * a failed check would be a lie, and raising the stack for every run would
 * hide the cases where recursion is genuinely unbounded.
 */
const run = async (name: string, command: string[]) => {
	const first = await spawnChecker(name, command);
	if (!first.output.includes(STACK_OVERFLOW)) return first;
	const [bin, ...args] = command;
	if (bin === undefined) return first;
	const deep = await spawnChecker(name, [
		'node',
		`--stack-size=${DEEP_STACK_KB}`,
		bin,
		...args
	]).catch(() => first);

	return deep.output.includes(STACK_OVERFLOW) ? first : deep;
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

// Dirs AbsoluteJS itself writes to. Tsc would crash typechecking them
// (codegen with non-resolvable paths, .ts-extension imports, etc.). These
// excludes are not opinions about project layout — they're about not
// type-checking AbsoluteJS's own generated output.
const ABSOLUTE_INTERNAL_EXCLUDES = [
	'.absolutejs/**/*',
	'**/build/**/*',
	'**/generated/**/*'
];

const resolveAbsoluteTypeFile = (fileName: string) => {
	const candidates = [
		resolve('node_modules/@absolutejs/absolute/dist/types', fileName),
		resolve(import.meta.dir, '../types', fileName),
		resolve(import.meta.dir, '../../types', fileName),
		resolve(import.meta.dir, '../../../types', fileName)
	];

	return (
		candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
	);
};

const ABSOLUTE_TYPECHECK_FILES = [
	resolveAbsoluteTypeFile('style-module-shim.d.ts')
];

const EMPTY_TSCONFIG: Record<string, unknown> = {};

// `tsconfig.json` is JSONC — comments and trailing commas are legal there and
// TypeScript's own reader accepts them. `JSON.parse` throws on both, and this
// reader's failure mode is silent: every generated config quietly degraded to
// the `**/*` fallback below, which widens each checker's program past the one
// the project's own tsconfig describes.
const readProjectTsconfig = () => {
	try {
		const parsed: unknown = parseJsonc(
			readFileSync(resolve('tsconfig.json'), 'utf-8')
		);

		return isRecord(parsed) ? parsed : EMPTY_TSCONFIG;
	} catch {
		return EMPTY_TSCONFIG;
	}
};

const toStringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];

const toGeneratedConfigPath = (path: string) =>
	path.startsWith('/') ? path : `../${path}`;

const getProjectSourceEntries = () => {
	const config = readProjectTsconfig();
	// If the user's tsconfig specifies `include`, respect it. Otherwise fall
	// back to tsc's default behavior (everything reachable from rootDir).
	const includes = toStringArray(config.include);

	return [
		...(includes.length > 0 ? includes : ['**/*']),
		...toStringArray(config.files)
	];
};

const getProjectTypecheckIncludes = () => [
	...getProjectSourceEntries().map(toGeneratedConfigPath),
	...ABSOLUTE_TYPECHECK_FILES
];

const LEAF_SEGMENT_REGEX = /[*?]|\.[^./]+$/;

// An include entry names sources; this rewrites it to name the same tree's
// declaration files instead — the entry is truncated at its first wildcard or
// filename segment and re-anchored on a recursive `.d.ts` glob, so `src` and
// `src/**/*` both become `src` + `/**/*.d.ts`. An entry that already names a
// `.d.ts` file is kept as it is.
const toDeclarationGlob = (entry: string) => {
	if (entry.endsWith('.d.ts')) return entry;
	const segments = entry.split('/');
	const leaf = segments.findIndex((segment) =>
		LEAF_SEGMENT_REGEX.test(segment)
	);
	const base = segments.slice(0, leaf < 0 ? segments.length : leaf).join('/');

	return base.length > 0 ? `${base}/**/*.d.ts` : '**/*.d.ts';
};

/**
 * The declaration-file subset of whatever the project's tsconfig includes.
 *
 * Ambient declarations — `declare global`, `declare module 'stylus'` — only
 * apply to a program that has the declaring file among its roots; an import
 * never pulls one in. The framework-scoped checkers (ngc, svelte-check)
 * narrow `include` to a single framework directory, so every ambient
 * declaration the project ships drops out of their programs, and any module
 * they reach through an import is then checked without the declarations it
 * legitimately relies on. Re-adding the declaration files — and only those —
 * restores them without making a scoped checker re-check the whole project.
 */
const getProjectDeclarationIncludes = () =>
	[...new Set(getProjectSourceEntries().map(toDeclarationGlob))].map(
		toGeneratedConfigPath
	);

const getProjectTypecheckExcludes = () => {
	const config = readProjectTsconfig();
	// Naming `exclude` at all turns off tsc's defaults, and one of those
	// defaults is the project's own output directory. Left off, a built
	// project would typecheck its emitted declarations back in as source.
	const outDir = getString(config.compilerOptions, 'outDir');

	return [
		...new Set(
			[
				...ABSOLUTE_INTERNAL_EXCLUDES,
				...toStringArray(config.exclude),
				...(outDir === null ? [] : [outDir])
			].map(toGeneratedConfigPath)
		)
	];
};

const buildVueTscCheck = async (cacheDir: string) => {
	const vueTscBin = findBin('vue-tsc');
	if (!vueTscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m vue-tsc is required for Vue type checking. Install it: bun add -d vue-tsc'
		);
		process.exit(1);
	}

	const vueTsconfigPath = join(cacheDir, 'tsconfig.vue-check.json');

	await writeFile(
		vueTsconfigPath,
		JSON.stringify(
			{
				compilerOptions: {
					rootDir: '..'
				},
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				include: getProjectTypecheckIncludes()
			},
			null,
			'\t'
		)
	);
	const base = [
		vueTscBin,
		'--noEmit',
		'--project',
		resolve(vueTsconfigPath),
		'--pretty'
	];
	const cached = await run('vue-tsc', [
		...base,
		'--incremental',
		'--tsBuildInfoFile',
		join(cacheDir, 'vue-tsc.tsbuildinfo')
	]);
	if (cached.exitCode === 0 || cached.output.length > 0) return cached;

	return run('vue-tsc', base);
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
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				include: [
					...getProjectDeclarationIncludes(),
					`../${angularDir}/**/*`
				]
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
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				include: getProjectTypecheckIncludes()
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
				files: ABSOLUTE_TYPECHECK_FILES,
				include: [
					...getProjectDeclarationIncludes(),
					`../${svelteDir}/**/*`
				]
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

/* Import advice: the static half of the import-cost diagnostic, run where a
 * heavy import can still be caught cheaply.
 *
 * It reports *shape* — an import whose bindings are only ever referenced
 * inside function bodies, and which could therefore be moved into them
 * without a refactor. It reports nothing about cost, because it cannot know
 * any: only a measured boot can, and this is not one.
 *
 * ## It never fails the build
 *
 * Deferring an import is a judgement call, not a defect. A deferrable import
 * worth 5ms should stay exactly where it is, and nothing here can tell that
 * one from the import worth 800ms. Failing on either would gate merges on a
 * measurement that has not been taken — which would make `absolute typecheck`
 * useless in the one place it currently earns its keep, because the way teams
 * respond to a check that fails for no good reason is to stop running it.
 *
 * So the exit code stays governed by real type errors, and the volume is
 * graded: one summary line unasked, the full listing behind
 * `--import-advice`.
 */

const IMPORT_ADVICE_FLAG = '--import-advice';

const importAdviceRequested = () =>
	process.argv.includes(IMPORT_ADVICE_FLAG) ||
	process.env.ABSOLUTE_IMPORT_ADVICE === '1';

/** Every service's server entry, deduplicated, keeping only the ones that are
 *  actually on disk — `absolute typecheck` also runs in plain TypeScript
 *  libraries, which have no server entry at all. */
export const serverEntryPaths = (targets: readonly AbsoluteServiceConfig[]) => [
	...new Set(
		targets
			.map((target) =>
				resolve(target.cwd ?? '.', target.entry ?? DEFAULT_SERVER_ENTRY)
			)
			.filter((path) => existsSync(path))
	)
];

const adviceFor = (path: string, detailed: boolean) => {
	const label = relative(process.cwd(), path) || path;
	const entries = deferrableEntryImports(readFileSync(path, 'utf-8'), path);

	return detailed
		? formatImportAdvice(entries, label)
		: summarizeImportAdvice(entries, label);
};

/** Advice must never be able to break the check it rides on, so an
 *  unreadable or unparseable entry is simply not advised about. */
const printAdviceFor = (path: string, detailed: boolean) => {
	try {
		const advice = adviceFor(path, detailed);
		if (advice !== null) console.log(advice);
	} catch {
		/* never at the expense of the typecheck */
	}
};

const reportImportAdvice = (
	targets: readonly AbsoluteServiceConfig[],
	detailed: boolean,
	passed: boolean
) => {
	if (!detailed && !passed) return;
	for (const path of serverEntryPaths(targets)) {
		printAdviceFor(path, detailed);
	}
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
	const detailedAdvice = importAdviceRequested();

	if (failed.length === 0) {
		console.log('\x1b[32m✓\x1b[0m Typecheck passed');
		reportImportAdvice(targets, detailedAdvice, true);

		return;
	}

	reportImportAdvice(targets, detailedAdvice, false);
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
