import { dirname, join, parse, relative, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
import { buildOutputGlobs } from '../buildOutputDirectories';
import { getString, isRecord } from '../config/guards';
import {
	bunCheckCommand,
	bunCheckSupported,
	NO_SCRIPT,
	checkFingerprint
} from './bunCheck';
import { DEFAULT_SERVER_ENTRY } from '../utils';
import {
	generateSvelteDeclarations,
	SVELTE_DECLARATIONS_ROOT,
	svelteDeclarationRootDirs,
	tsconfigHasSvelteDeclarationRoot
} from '../../build/svelteDeclarations';
import { ensureFileRouteModule } from '../../build/fileRoutes';
import { writeManifestKeysDeclaration } from '../../build/manifestKeys';
import { writeRouteMapDeclaration } from '../../build/routeMap';
import { manifestKeysEditorHint } from './manifestKeysEditorHint';
import {
	diagnosticKeys,
	svelteCheckReport,
	withoutReported
} from './typecheckDiagnostics';
import type {
	AbsoluteServiceConfig,
	ServiceConfig
} from '../../../types/build';

type CheckerResult = {
	name: string;
	exitCode: number;
	/** Printed whether or not the check passed. Accessibility warnings go
	 *  here: they are worth seeing on a green run, which is the only kind
	 *  of run most projects have, and the failure path prints `output`
	 *  only. */
	notes?: string;
	output: string;
};

/* A config or a shim this command generates, written only when it differs
 * from what is there. A checker that remembers its last run compares what it
 * read by modification time (vue-check does; tsc's and vue-tsc's incremental
 * builds read these files too), so an unchanged file must keep its time. */
const writeIfChanged = async (path: string, content: string) => {
	if (existsSync(path) && readFileSync(path, 'utf-8') === content) return;
	await writeFile(path, content);
};

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

/* A checker that notices it is running in GitHub Actions prints a
 * `::error file=…` workflow command beside each diagnostic — bun check
 * does — so every error reached the log twice: once in the shape this
 * command renders, once as an annotation it never saw. The second copy
 * also bypassed the de-duplication below, so an error two checkers both
 * found could be annotated by the one whose copy was dropped, and the
 * annotation's path is relative to the checker's own config rather than
 * the workspace, which GitHub cannot resolve.
 *
 * This command owns what reaches the log, so checkers run without that
 * signal. */
const checkerEnv = () => {
	const env: Record<string, string | undefined> = { ...process.env };
	Reflect.deleteProperty(env, 'GITHUB_ACTIONS');

	return env;
};

const spawnChecker = async (
	name: string,
	command: string[]
): Promise<CheckerResult> => {
	const proc = Bun.spawn(command, {
		env: checkerEnv(),
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

// Dirs AbsoluteJS itself writes to. Tsc would crash typechecking them
// (codegen with non-resolvable paths, .ts-extension imports, etc.). These
// excludes are not opinions about project layout — they're about not
// type-checking AbsoluteJS's own generated output.
const ABSOLUTE_INTERNAL_EXCLUDES = ['.absolutejs/**/*', '**/generated/**/*'];

/* The build output, by where the config says it goes — see
 * `buildOutputGlobs`. This was `**\/build/**`, which took every directory
 * NAMED `build` out of the program, source included: in this repository
 * that was 107 test files, among them the type tests for `defineConfig`. */
let buildOutputExcludes = buildOutputGlobs([{}]);

const setBuildOutputExcludes = (targets: AbsoluteServiceConfig[]) => {
	buildOutputExcludes = buildOutputGlobs(targets);
};

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

/* `.vue` imports, for the plain checker (bun check or tsc) in a project
 * with Vue. That checker is the one that sees Svelte page props, so it runs
 * over the server code alongside vue-check rather than being replaced by
 * it, and it can't resolve a `.vue` file on its own (TS2307).
 *
 * One declaration per component file name (`*\/Profile.vue`), not a single
 * `*.vue`: a project that ships its own `declare module '*.vue'` would merge
 * with that and fail on two default exports (TS2300). The type is the
 * permissive shim Vue projects used before Volar; the component's real props
 * are checked by vue-check, which never reads this file. */
let vueShimPath: string | null = null;

const VUE_SHIM_FILE = 'typecheck-vue-shim.d.ts';
const SKIPPED_SCAN_DIRECTORIES = new Set([
	'build',
	'generated',
	'node_modules'
]);

/** Every `.vue` and `.svelte` file in the project, wherever it lives: page
 *  components sit under the framework directories, but islands usually sit
 *  beside the registry (src/islands/), and both are imported from server
 *  code. Dot-directories (.absolutejs, .git), node_modules and build output
 *  are skipped. */
const isScannedDirectory = (name: string) =>
	!name.startsWith('.') && !SKIPPED_SCAN_DIRECTORIES.has(name);

const walkComponentFiles = (
	dir: string,
	skipped: ReadonlySet<string>
): string[] => {
	if (!existsSync(dir) || skipped.has(dir)) return [];

	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return isScannedDirectory(entry.name)
				? walkComponentFiles(path, skipped)
				: [];

		return entry.name.endsWith('.vue') || entry.name.endsWith('.svelte')
			? [path]
			: [];
	});
};

export const collectComponentFiles = (
	dir: string,
	skipped: ReadonlySet<string> = new Set()
) => {
	const files = walkComponentFiles(dir, skipped);

	return {
		svelte: files.filter((file) => file.endsWith('.svelte')),
		vue: files.filter((file) => file.endsWith('.vue'))
	};
};

export const vueShimSource = (fileNames: readonly string[]) =>
	[...new Set(fileNames)]
		.sort()
		.map(
			(fileName) =>
				`declare module ${JSON.stringify(`*/${fileName}`)} {\n\timport type { DefineComponent } from 'vue';\n\tconst component: DefineComponent<{}, {}, any>;\n\texport default component;\n}\n`
		)
		.join('\n');

const prepareVueShim = async (cacheDir: string, vueFiles: string[]) => {
	const fileNames = vueFiles.map((file) => parse(file).base);
	if (fileNames.length === 0) return;
	const shimPath = resolve(cacheDir, VUE_SHIM_FILE);
	await writeIfChanged(shimPath, vueShimSource(fileNames));
	vueShimPath = shimPath;
};

/* `.svelte` imports, for the Vue checker. vue-check writes its own
 * `rootDirs` (the project joined to its generated Vue code), which replaces
 * the ones joining the project to the generated Svelte declarations, so a
 * `.svelte` import there (an island registry importing both kinds) is
 * TS2307 unless the project happens to load Svelte's ambient `*.svelte`.
 * Svelte props are checked by the plain checker against the real
 * declarations; here the component only has to resolve, so it gets the
 * type Svelte's own ambient `*.svelte` gives it (any props), and nothing
 * typed by it is reported twice. Per file name, for the same
 * reason as the Vue shim. */
let svelteShimPath: string | null = null;

const SVELTE_SHIM_FILE = 'typecheck-svelte-shim.d.ts';

export const svelteShimSource = (fileNames: readonly string[]) =>
	[...new Set(fileNames)]
		.sort()
		.map(
			(fileName) =>
				`declare module ${JSON.stringify(`*/${fileName}`)} {\n\timport type { SvelteComponent } from 'svelte';\n\timport type { LegacyComponentType } from 'svelte/legacy';\n\tconst component: LegacyComponentType;\n\ttype component = SvelteComponent;\n\texport default component;\n}\n`
		)
		.join('\n');

const prepareSvelteShim = async (cacheDir: string, svelteFiles: string[]) => {
	const fileNames = svelteFiles.map((file) => parse(file).base);
	if (fileNames.length === 0) return;
	const shimPath = resolve(cacheDir, SVELTE_SHIM_FILE);
	await writeIfChanged(shimPath, svelteShimSource(fileNames));
	svelteShimPath = shimPath;
};

const isWithin = (dir: string, path: string) => {
	const rel = relative(dir, path);

	return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
};

/** The directories Svelte declarations are generated for (and svelte-check
 *  runs over): each configured svelteDirectory, plus the folder of every
 *  `.svelte` file outside them (an island beside its registry), with a
 *  folder inside another one folded into it so no two mirrors overlap.
 *  Relative to the project root. */
export const svelteRoots = (
	projectRoot: string,
	svelteDirs: readonly string[],
	svelteFiles: readonly string[]
) => {
	const configured = svelteDirs.map((dir) => resolve(projectRoot, dir));
	const strays = svelteFiles
		.filter((file) => !configured.some((dir) => isWithin(dir, file)))
		.map((file) => dirname(file));
	const candidates = [...new Set([...configured, ...strays])].sort(
		(left, right) => left.length - right.length
	);
	const roots = candidates.reduce<string[]>(
		(kept, dir) =>
			kept.some((root) => isWithin(root, dir)) ? kept : [...kept, dir],
		[]
	);

	return roots.map((dir) => relative(projectRoot, dir) || '.');
};

/* The generated declarations — manifest keys (build/manifestKeys.ts) and
 * the route map (build/routeMap.ts), each written per project root and
 * only when that project has any: listed in each config that checks server
 * code, so `asset(manifest, 'Abuot')` and `route('/abuot')` are errors.
 * They sit under .absolutejs, which the configs exclude, so they are named
 * in `files`. */
let generatedDeclarations: string[] = [];

const prepareManifestKeys = async (
	targets: readonly AbsoluteServiceConfig[]
) => {
	const byRoot = new Map<string, AbsoluteServiceConfig[]>();
	for (const target of targets) {
		const root = resolve(target.cwd ?? '.');
		byRoot.set(root, [...(byRoot.get(root) ?? []), target]);
	}
	const written = await Promise.all(
		[...byRoot].flatMap(([root, configs]) => [
			writeManifestKeysDeclaration(configs, root),
			writeRouteMapDeclaration(configs, root)
		])
	);
	generatedDeclarations = written.filter(
		(path): path is string => path !== null
	);
	if (generatedDeclarations.length === 0) return;
	const hint = manifestKeysEditorHint(
		readProjectTsconfig(),
		generatedDeclarations.map((path) => relative(process.cwd(), path))
	);
	if (hint) console.log(hint);
};

/* `rootDirs` for the generated configs once Svelte declarations exist: the
 * project's own entries (re-anchored on the cache directory) plus the
 * declaration mirror, so `import type Page from './Page.svelte'` in server
 * code resolves to its generated `Page.svelte.d.ts`. */
let svelteDeclarationsReady = false;

const getTypecheckRootDirs = (cacheDir: string) => {
	if (!svelteDeclarationsReady) return {};
	const { compilerOptions } = readProjectTsconfig();
	const projectRootDirs = toStringArray(
		isRecord(compilerOptions) ? compilerOptions.rootDirs : undefined
	).map(toGeneratedConfigPath);

	return {
		rootDirs: [
			...new Set([
				...projectRootDirs,
				...svelteDeclarationRootDirs(resolve('.'), resolve(cacheDir))
			])
		]
	};
};

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
				...buildOutputExcludes,
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

	await writeIfChanged(
		vueTsconfigPath,
		JSON.stringify(
			{
				compilerOptions: {
					rootDir: '..',
					...getTypecheckRootDirs(cacheDir)
				},
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				include: getProjectTypecheckIncludes(),
				...(generatedDeclarations.length > 0
					? { files: generatedDeclarations }
					: {})
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

/* vue-check (@absolutejs/vue-check): the project's own Vue codegen with
 * bun check as the checker, reporting the errors vue-tsc reports. It reads
 * the same program bun check does, and keeps its generated TypeScript in the
 * cache, never the project. */
const buildVueCheck = async (cacheDir: string) => {
	const configPath = await writeTypecheckConfig(cacheDir, 'vue');
	const vueCheck = join(
		dirname(
			Bun.resolveSync(
				'@absolutejs/vue-check/package.json',
				import.meta.dir
			)
		),
		'src/cli.ts'
	);

	return run('vue-check', [
		process.execPath,
		vueCheck,
		'-p',
		configPath,
		`--out-dir=${resolve(cacheDir, 'vue-check')}`
	]);
};

/* One ngc run over every Angular directory: a run per directory would write
 * this same config concurrently, and check whichever directory won. */
const buildAngularCheck = async (
	cacheDir: string,
	angularDirs: string[],
	useBunCheck: boolean
) => {
	const ngcBin = findBin('ngc');
	if (!ngcBin) {
		console.error(
			'\x1b[31m✗\x1b[0m @angular/compiler-cli is required for Angular type checking. Install it: bun add -d @angular/compiler-cli'
		);
		process.exit(1);
	}

	const angularTsconfigPath = join(cacheDir, 'tsconfig.angular-check.json');
	await writeIfChanged(
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
					...angularDirs.map((angularDir) => `../${angularDir}/**/*`)
				]
			},
			null,
			'\t'
		)
	);

	if (!useBunCheck)
		return runShell(
			'ngc',
			`${shellEscape(ngcBin)} -p ${shellEscape(resolve(angularTsconfigPath))}`
		);

	/* angular-check (@absolutejs/angular-check): the project's own Angular
	 * compiler builds the program and generates the template check code, as
	 * ngc does, and `bun check` type-checks it in place of TypeScript in
	 * Node. The compiler maps and prints the errors, so the output is ngc's.
	 * A compiler angular-check can't drive is checked by ngc itself. */
	const angularCheck = join(
		dirname(
			Bun.resolveSync(
				'@absolutejs/angular-check/package.json',
				import.meta.dir
			)
		),
		'src/cli.ts'
	);

	return run('angular-check', [
		process.execPath,
		angularCheck,
		'-p',
		resolve(angularTsconfigPath),
		`--out-dir=${resolve(cacheDir, 'angular-check')}`
	]);
};

type TypecheckProgram = 'bun' | 'tsc' | 'vue';

const TYPECHECK_CONFIG_FILES: Record<TypecheckProgram, string> = {
	bun: 'tsconfig.typecheck.bun.json',
	tsc: 'tsconfig.typecheck.json',
	vue: 'tsconfig.typecheck.vue.json'
};

/* The program tsc, bun check and vue-check read: the project's own
 * tsconfig, minus the directories AbsoluteJS generates, plus its style
 * shims. Each gets its own file, since they are written concurrently. */
const writeTypecheckConfig = async (
	cacheDir: string,
	checker: TypecheckProgram
) => {
	const tscConfigPath = join(cacheDir, TYPECHECK_CONFIG_FILES[checker]);
	/* The plain checker can't read a .vue file, so it reads each one as
	 * the shim declares it; vue-check reads the real component instead, and
	 * reads each .svelte file as its own shim declares it. */
	const shim = checker === 'vue' ? svelteShimPath : vueShimPath;
	const shimFiles = [
		...(shim === null ? [] : [shim]),
		...generatedDeclarations
	];
	await writeIfChanged(
		tscConfigPath,
		JSON.stringify(
			{
				/* TypeScript 7 requires every source file to sit under
				 * rootDir even when nothing is emitted (TS6059). Pinned to
				 * the project, a test importing a script beside the project
				 * failed bun check; left unset, rootDir defaults to this
				 * file's directory (.absolutejs) whenever the project's
				 * tsconfig sets outDir, so every source file failed (the
				 * docs site: 20 TS6059 errors, 2026-11-01). bun check never
				 * emits, so its root only has to contain every file it
				 * reads: the filesystem root does. tsc's incremental output
				 * still needs the project root. */
				compilerOptions: {
					rootDir:
						checker === 'tsc' ? '..' : parse(resolve('.')).root,
					...getTypecheckRootDirs(cacheDir)
				},
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				include: getProjectTypecheckIncludes(),
				...(shimFiles.length > 0 ? { files: shimFiles } : {})
			},
			null,
			'\t'
		)
	);

	return resolve(tscConfigPath);
};

const buildTscCheck = async (cacheDir: string) => {
	const tscBin = findBin('tsc');
	if (!tscBin) {
		console.error(
			'\x1b[31m✗\x1b[0m typescript is required for type checking. Install it: bun add -d typescript'
		);
		process.exit(1);
	}
	const tscConfigPath = await writeTypecheckConfig(cacheDir, 'tsc');

	return run('tsc', [
		tscBin,
		'--noEmit',
		'--project',
		tscConfigPath,
		'--incremental',
		'--tsBuildInfoFile',
		join(cacheDir, 'tsc.tsbuildinfo'),
		'--pretty'
	]);
};

const BUN_CHECK_PASS_FILE = 'bun-check.pass';
const UNCHANGED = 'unchanged since the last pass';

/* bun check keeps no .tsbuildinfo, so the incremental step lives here: a
 * pass is remembered as the fingerprint of everything it read, and an
 * unchanged program is not checked again. Only passes are remembered, so a
 * failing project always re-runs and shows its errors. */
const buildBunCheck = async (cacheDir: string) => {
	const configPath = await writeTypecheckConfig(cacheDir, 'bun');
	const passFile = join(cacheDir, BUN_CHECK_PASS_FILE);
	const listing = await spawnChecker('bun check', [
		process.execPath,
		'check',
		'-p',
		configPath,
		'--listFilesOnly',
		NO_SCRIPT
	]);
	const fingerprint =
		listing.exitCode === 0
			? checkFingerprint(listing.output, configPath)
			: null;
	const lastPass = existsSync(passFile)
		? readFileSync(passFile, 'utf-8').trim()
		: null;
	if (fingerprint !== null && fingerprint === lastPass)
		return { exitCode: 0, name: 'bun check', output: UNCHANGED };

	const result = await spawnChecker('bun check', bunCheckCommand(configPath));
	if (result.exitCode === 0 && fingerprint !== null)
		await writeFile(passFile, `${fingerprint}\n`);
	else if (existsSync(passFile)) await rm(passFile, { force: true });

	return result;
};

/** What svelte-check's program includes for each Svelte root: a configured
 *  svelteDirectory whole, as it always was, and only the `.svelte` files of
 *  a root outside one (an island folder), whose `.ts` files (the registry)
 *  belong to the plain checker and would otherwise be reported twice.
 *  Beside each such glob goes the one for `.d.svelte.ts`: svelte-check's
 *  native mode checks a component only if the include also matches the
 *  declaration it generates for it, and otherwise skips it silently
 *  (sveltejs/language-tools#3201). No such file exists on disk, so the plain
 *  mode is unaffected.
 *  Relative to the generated config in the cache directory. */
export const svelteCheckIncludes = (
	projectRoot: string,
	configuredDirs: readonly string[],
	roots: readonly string[]
) => {
	const configured = configuredDirs.map((dir) => resolve(projectRoot, dir));
	const strays = roots.filter(
		(root) =>
			!configured.some((dir) => isWithin(dir, resolve(projectRoot, root)))
	);

	return [
		...configured.map(
			(dir) => `../${relative(projectRoot, dir) || '.'}/**/*`
		),
		...strays.flatMap((root) => [
			`../${root}/**/*.svelte`,
			`../${root}/**/*.d.svelte.ts`
		])
	];
};

/* One svelte-check run over every Svelte root, under one label. beta.180 ran
 * one per root, each writing this same config concurrently: the last write
 * won, every run checked the same root, and the others were never checked. */
/* svelte-check checks with the project's TypeScript, in JavaScript. From 4.7
 * it can hand the type-checking to TypeScript 7's native checker instead
 * (`--tsgo-experimental-api`), which it finds as `@typescript/native` (an
 * alias of typescript@7) or `@typescript/native-preview` from the tsconfig's
 * folder. Both have to be there: an older svelte-check doesn't know the flag,
 * and without TypeScript 7 it stops with an error.
 *
 * `absolute add svelte` and the hint below install `@typescript/native-preview`,
 * whose only command is `tsgo`. typescript@7 under the alias brings a `tsc`
 * that replaces the project's own in node_modules/.bin.
 */
const SVELTE_NATIVE_FLAG = '--tsgo-experimental-api';
const NATIVE_TYPESCRIPT_PACKAGES = [
	'@typescript/native',
	'@typescript/native-preview'
];
const NATIVE_TYPESCRIPT_NAMES = new Set([
	'typescript',
	'@typescript/native-preview'
]);
const NATIVE_TYPESCRIPT_MAJOR = 7;

const packageManifest = (name: string, from: string) => {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(Bun.resolveSync(`${name}/package.json`, from), 'utf8')
		);

		return typeof parsed === 'object' && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
};

const isNativeTypeScript = (manifest: object | null) => {
	if (manifest === null) return false;
	const name = 'name' in manifest ? manifest.name : undefined;
	const version = 'version' in manifest ? manifest.version : undefined;
	if (typeof name !== 'string' || typeof version !== 'string') return false;

	return (
		NATIVE_TYPESCRIPT_NAMES.has(name) &&
		Number.parseInt(version, 10) >= NATIVE_TYPESCRIPT_MAJOR
	);
};

const svelteCheckKnowsNativeFlag = (from: string) => {
	try {
		const entry = join(
			dirname(Bun.resolveSync('svelte-check/package.json', from)),
			'dist/src/index.js'
		);

		return readFileSync(entry, 'utf8').includes(SVELTE_NATIVE_FLAG);
	} catch {
		return false;
	}
};

const nativeTypeScriptInstalled = (from: string) =>
	NATIVE_TYPESCRIPT_PACKAGES.some((name) =>
		isNativeTypeScript(packageManifest(name, from))
	);

const SVELTE_NATIVE_HINT = `\x1b[33mnote\x1b[0m Svelte is type-checked with the project's TypeScript. svelte-check checks several times faster with TypeScript 7's native checker. Install it to enable: bun add -d @typescript/native-preview`;

/* A run that printed no summary never checked anything: the native mode
 * stopped on a TypeScript 7 version it doesn't support, or on its own error. */
const SVELTE_COMPLETED = / COMPLETED \d+ FILES /;

const buildSvelteCheck = async (
	cacheDir: string,
	includes: string[],
	useBunCheck: boolean
) => {
	const svelteBin = findBin('svelte-check');
	if (!svelteBin) {
		console.error(
			'\x1b[31m✗\x1b[0m svelte-check is required for Svelte type checking. Install it: bun add -d svelte-check'
		);
		process.exit(1);
	}

	const svelteTsconfigPath = join(cacheDir, 'tsconfig.svelte-check.json');
	await writeIfChanged(
		svelteTsconfigPath,
		JSON.stringify(
			{
				// svelte-check gives a component with no `<script lang="ts">`
				// the JS script kind. Without allowJs, importing one (a
				// script-less component above all) fails with TS7016. This
				// only lets those components resolve: checkJs stays as the
				// project set it, so no JavaScript starts being checked.
				compilerOptions: { allowJs: true },
				// The project's own excludes and outDir, as every other
				// checker's config has: an island folder's glob would
				// otherwise reach into them.
				exclude: getProjectTypecheckExcludes(),
				extends: resolve('tsconfig.json'),
				// The Vue shim lets a `.vue` import beside a Svelte file (an
				// island registry importing both kinds) resolve here too.
				files: [
					...ABSOLUTE_TYPECHECK_FILES,
					...(vueShimPath === null ? [] : [vueShimPath])
				],
				include: [...getProjectDeclarationIncludes(), ...includes]
			},
			null,
			'\t'
		)
	);

	const command = [
		svelteBin,
		'--tsconfig',
		resolve(svelteTsconfigPath),
		/* Warning, not error: svelte-check reports accessibility findings
		 * as warnings, so at `error` they never reached this process.
		 * Pass/fail is still decided by errors alone — see
		 * `svelteCheckReport`, which counts them and merely prints the
		 * accessibility warnings. */
		'--threshold',
		'warning',
		'--compiler-warnings',
		'css-unused-selector:ignore',
		'--output',
		// Read by dedupeSvelteResult, which renders it for people.
		'machine-verbose'
	];
	const from = resolve(cacheDir);
	const nativePossible = useBunCheck && svelteCheckKnowsNativeFlag(from);
	const nativeInstalled = nativePossible && nativeTypeScriptInstalled(from);
	if (nativePossible && !nativeInstalled) console.log(SVELTE_NATIVE_HINT);
	if (!nativeInstalled) return run('svelte-check', command);
	const native = await run('svelte-check', [...command, SVELTE_NATIVE_FLAG]);

	return SVELTE_COMPLETED.test(native.output)
		? native
		: run('svelte-check', command);
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

const SVELTE_EDITOR_HINT = `\x1b[33mnote\x1b[0m Svelte page props are type-checked in server files by this command. For the same errors in your editor, add "${SVELTE_DECLARATIONS_ROOT}" to compilerOptions.rootDirs in tsconfig.json: "rootDirs": [".", "${SVELTE_DECLARATIONS_ROOT}"]`;

/* Generates the Svelte component declarations server code is checked
 * against (build/svelteDeclarations.ts). Unchanged projects reuse the last
 * output, so this costs a directory stat walk on a warm run. */
const prepareSvelteDeclarations = async (svelteDirs: string[]) => {
	const results = await Promise.all(
		svelteDirs.map((svelteDirectory) =>
			generateSvelteDeclarations({
				projectRoot: resolve('.'),
				svelteDirectory
			})
		)
	);
	svelteDeclarationsReady = results.some(
		(result) => result.status !== 'unavailable'
	);
	const unavailable = results.find(
		(result) => result.status === 'unavailable'
	);
	if (unavailable?.status === 'unavailable') {
		const install = unavailable.reason.includes('svelte2tsx')
			? ' Install it to enable: bun add -d svelte2tsx'
			: '';
		console.log(
			`\x1b[33mnote\x1b[0m Svelte page props in server files are not type-checked: ${unavailable.reason}.${install}`
		);
	}
	const { compilerOptions } = readProjectTsconfig();
	const editorReady =
		isRecord(compilerOptions) &&
		tsconfigHasSvelteDeclarationRoot(compilerOptions.rootDirs);
	if (svelteDeclarationsReady && !editorReady)
		console.log(SVELTE_EDITOR_HINT);
};

const VUE_CHECKERS = new Set(['vue-check', 'vue-tsc']);
const ANGULAR_CHECKERS = new Set(['angular-check', 'ngc']);
const PLAIN_CHECKERS = new Set(['bun check', 'tsc']);

/* A framework checker's errors that the plain checker already reported,
 * dropped from the framework checker's output. When nothing is left, that
 * checker passed: all it found is already on screen. A run that printed no
 * positioned error at all (a crash, exit 3) still fails. */
const dedupeAgainstPlain = (
	results: CheckerResult[],
	checkers: ReadonlySet<string>,
	checkerCwd = process.cwd()
) => {
	const plain = results.find((res) => PLAIN_CHECKERS.has(res.name));
	if (!plain || plain.exitCode === 0) return results;
	const reported = diagnosticKeys(plain.output);

	return results.map((res) => {
		if (!checkers.has(res.name) || res.exitCode === 0) return res;
		const { dropped, output, remaining } = withoutReported(
			res.output,
			reported,
			checkerCwd
		);
		if (dropped === 0) return res;
		const passed = remaining === 0 && output.length === 0;

		return { ...res, exitCode: passed ? 0 : res.exitCode, output };
	});
};

/* ngc's program includes the Angular directory, which the plain checker
 * reads too, so an error in a component's TypeScript (a wrong field type)
 * is in both outputs at the same position and code. It is reported once,
 * under the plain checker. ngc keeps what only it sees: template errors
 * (strictTemplates type-checks bindings the plain checker never reads) and
 * Angular's own NG diagnostics. ngc prints paths relative to its config,
 * which sits in the cache directory. */
export const dedupeAngularResult = (
	results: CheckerResult[],
	cacheDir: string
) => dedupeAgainstPlain(results, ANGULAR_CHECKERS, resolve(cacheDir));

/* vue-check reads every .ts file bun check reads, so an error in plain
 * TypeScript (a React prop, say) is in both outputs. It is reported once,
 * under the plain checker; vue-check keeps the errors only it can see — in
 * .vue files, and in .ts code typed by a Vue component. */
export const dedupeVueResult = (results: CheckerResult[]) =>
	dedupeAgainstPlain(results, VUE_CHECKERS);

const readSource = (file: string) => {
	try {
		return readFileSync(file, 'utf-8');
	} catch {
		return null;
	}
};

/* svelte-check runs with machine-readable output: its errors are read,
 * the ones the plain checker already reported are dropped (a plain
 * TypeScript error in a `.ts` file inside a configured svelteDirectory is in
 * both programs), and the rest are rendered in tsc's pretty shape. When
 * every error was a duplicate, svelte-check passed. A run with nothing
 * recognisable in its output keeps that output, and its failure. */
export const dedupeSvelteResult = (
	results: CheckerResult[],
	read: (file: string) => string | null = readSource
) => {
	const plain = results.find((res) => PLAIN_CHECKERS.has(res.name));
	const reported =
		plain && plain.exitCode !== 0
			? diagnosticKeys(plain.output)
			: new Set<string>();

	return results.map((res) => {
		/* Not `|| res.exitCode === 0`, which used to skip this entirely on
		 * a clean run. svelte-check exits 0 even with warnings present
		 * (measured: 20 warnings, exit 0), so an early return there means
		 * the accessibility findings are never looked at — which is the
		 * second half of why they were invisible. */
		if (res.name !== 'svelte-check') return res;
		const { accessibilityOutput, dropped, output, remaining } =
			svelteCheckReport(res.output, reported, read);
		const notes =
			accessibilityOutput.length > 0 ? accessibilityOutput : undefined;
		if (remaining === 0 && dropped === 0 && notes === undefined) return res;

		return {
			...res,
			exitCode: remaining === 0 ? 0 : res.exitCode,
			notes,
			output
		};
	});
};

export const typecheck = async (configPath?: string) => {
	const targets = await getTypecheckTargets(configPath);
	setBuildOutputExcludes(targets);

	const hasAngular = targets.some((config) =>
		Boolean(config.angularDirectory)
	);
	const configuredSvelteDirs = [
		...new Set(
			targets
				.map((config) => config.svelteDirectory)
				.filter(
					(dir): dir is string =>
						typeof dir === 'string' && dir.length > 0
				)
		)
	];
	// The project's build output and its tsconfig outDir (a package's dist/,
	// copies of its own components) are output, not source.
	const outDir = getString(readProjectTsconfig().compilerOptions, 'outDir');
	const componentFiles = collectComponentFiles(
		resolve('.'),
		new Set([
			...targets.flatMap((config) =>
				config.buildDirectory ? [resolve(config.buildDirectory)] : []
			),
			...(outDir === null ? [] : [resolve(outDir)])
		])
	);
	// A `.vue` or `.svelte` file anywhere in the project (an island beside
	// its registry, with no page directory configured) brings its checker.
	const hasVue =
		targets.some((config) => Boolean(config.vueDirectory)) ||
		componentFiles.vue.length > 0;
	const svelteDirs = svelteRoots(
		resolve('.'),
		configuredSvelteDirs,
		componentFiles.svelte
	);
	const hasSvelte = svelteDirs.length > 0;
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
	await prepareManifestKeys(targets);
	if (hasSvelte) await prepareSvelteDeclarations(svelteDirs);
	// File routes: the route module carries the load/props checks.
	for (const config of targets) ensureFileRouteModule(config);
	const checks: Promise<CheckerResult>[] = [];

	// bun check does tsc's job (Bun 1.4.4+), and runs in every project: it
	// is the checker that resolves Svelte components to their generated
	// declarations. With Vue, vue-check (vue-tsc's job) runs beside it, not
	// in its place: it covers .vue files and the .ts code that imports them,
	// and reports only what bun check didn't (dedupeVueResult). tsc and
	// vue-tsc remain the fallback on older Bun or with
	// ABSOLUTE_TYPECHECK_CHECKER=tsc.
	const useBunCheck = bunCheckSupported();
	const plainCheck = useBunCheck ? buildBunCheck : buildTscCheck;
	const vueCheck = useBunCheck ? buildVueCheck : buildVueTscCheck;
	if (hasVue) await prepareVueShim(cacheDir, componentFiles.vue);
	if (hasVue && useBunCheck)
		await prepareSvelteShim(cacheDir, componentFiles.svelte);
	checks.push(plainCheck(cacheDir));
	if (hasVue) checks.push(vueCheck(cacheDir));

	// svelte-check, once, over every Svelte root (pages and islands)
	if (hasSvelte)
		checks.push(
			buildSvelteCheck(
				cacheDir,
				svelteCheckIncludes(
					resolve('.'),
					configuredSvelteDirs,
					svelteDirs
				),
				useBunCheck
			)
		);

	// ngc or angular-check, once, over every Angular directory
	if (hasAngular && angularDirs.length > 0)
		checks.push(buildAngularCheck(cacheDir, angularDirs, useBunCheck));

	const results = dedupeAngularResult(
		dedupeSvelteResult(dedupeVueResult(await Promise.all(checks))),
		cacheDir
	);
	const failed = results.filter((res) => res.exitCode !== 0);
	const detailedAdvice = importAdviceRequested();

	for (const result of results)
		if (result.notes !== undefined) console.log(result.notes);

	if (failed.length === 0) {
		const unchanged = results.every((res) => res.output === UNCHANGED);
		console.log(
			`\x1b[32m✓\x1b[0m Typecheck passed${unchanged ? ` (${UNCHANGED})` : ''}`
		);
		reportImportAdvice(targets, detailedAdvice, true);

		return;
	}

	reportImportAdvice(targets, detailedAdvice, false);
	for (const result of failed) {
		console.error(`\n\x1b[31m[${result.name}]\x1b[0m`);
		console.error(result.output);
	}
	console.error(
		`\n\x1b[31m✗\x1b[0m Typecheck failed: ${failed.map((res) => res.name).join(', ')}`
	);
	process.exit(1);
};
