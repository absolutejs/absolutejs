import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/* Precise types for `import type Page from './Page.svelte'` in server code.
 *
 * Svelte's own ambient `declare module '*.svelte'` types every component as
 * `LegacyComponentType`, whose props are `Record<string, any>`, so
 * `handleSveltePageRequest<typeof Page>({ props })` accepted any props. This
 * module asks svelte2tsx (the engine svelte-check runs on) for a declaration
 * per component and writes them to a mirror of the project tree:
 *
 *   <root>/src/svelte/pages/Pricing.svelte
 *   <root>/.absolutejs/types/svelte/src/svelte/pages/Pricing.svelte.d.ts
 *
 * With the mirror in tsconfig `rootDirs`, TypeScript resolves the relative
 * import `./svelte/pages/Pricing.svelte` to the generated
 * `Pricing.svelte.d.ts` (`Component<{ cssPath: string }>`), which wins over
 * the ambient wildcard. `absolute typecheck` adds the `rootDirs` entry to the
 * configs it generates; editors read the project's own tsconfig, which needs
 * the same entry (see `SVELTE_DECLARATIONS_ROOT`). */

/** Mirror root, relative to the project root. */
export const SVELTE_DECLARATIONS_ROOT = '.absolutejs/types/svelte';

const FINGERPRINT_FILE = '.fingerprint';
const SKIPPED_DIRECTORIES = new Set(['.absolutejs', 'build', 'node_modules']);

/* svelte2tsx's `emitDts` runs in a child process, for two reasons:
 *   - it emits a declaration for every file the components import, wherever
 *     it lives, and writes the ones outside the Svelte directory next to
 *     their sources (a stray `src/types/metadata.d.ts` in the user's tree).
 *     The child restricts `ts.sys.writeFile`, which emitDts writes through,
 *     to the staging directory; patching it in the dev server's own process
 *     would affect every other TypeScript user there;
 *   - it resolves output paths against `process.cwd()`, which the child sets
 *     to the project root. */
const EMIT_SCRIPT = `
const { resolve, sep } = require('node:path');
const { shimsPath, stagingDir, svelte2tsxPath, svelteDir, tsconfigPath, typescriptPath } =
	JSON.parse(process.env.ABSOLUTE_SVELTE_DTS ?? '{}');
const ts = require(typescriptPath);
const allowed = resolve(stagingDir) + sep;
const writeFile = ts.sys.writeFile;
ts.sys.writeFile = (file, data, bom) => {
	if (resolve(file).startsWith(allowed)) writeFile(file, data, bom);
};
const { emitDts } = require(svelte2tsxPath);
emitDts({
	declarationDir: stagingDir,
	libRoot: svelteDir,
	svelteShimsPath: shimsPath,
	tsconfig: tsconfigPath
}).catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
`;

const runEmit = async (projectRoot: string, args: Record<string, string>) => {
	const child = Bun.spawn([process.execPath, '-e', EMIT_SCRIPT], {
		cwd: projectRoot,
		env: { ...process.env, ABSOLUTE_SVELTE_DTS: JSON.stringify(args) },
		stderr: 'pipe',
		stdout: 'ignore'
	});
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text()
	]);

	return { exitCode, stderr: stderr.trim() };
};

export type SvelteDeclarationsResult =
	| { status: 'generated'; durationMs: number; outDir: string }
	| { status: 'unchanged'; outDir: string }
	| { status: 'unavailable'; reason: string };

const resolveFrom = (specifier: string, projectRoot: string) => {
	try {
		return Bun.resolveSync(specifier, projectRoot);
	} catch {
		return null;
	}
};

const DECLARATION_INPUT = /\.(?:svelte|ts|js|mts|cts)$/;
const HASH_RADIX = 36;

/** Every file under `dir` that can change a declaration, with its stat. */
const collectInputs = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return SKIPPED_DIRECTORIES.has(entry.name)
				? []
				: collectInputs(path);
		if (!DECLARATION_INPUT.test(entry.name)) return [];
		const { mtimeMs, size } = statSync(path);

		return [`${path}\0${mtimeMs}\0${size}`];
	});

const fingerprintOf = (
	svelteDir: string,
	tsconfigPath: string,
	svelte2tsxPath: string
) => {
	const svelte2tsxManifest = join(dirname(svelte2tsxPath), 'package.json');
	const inputs = [
		...collectInputs(svelteDir).sort(),
		readFileSync(tsconfigPath, 'utf-8'),
		svelte2tsxPath,
		existsSync(svelte2tsxManifest)
			? readFileSync(svelte2tsxManifest, 'utf-8')
			: ''
	];

	return Bun.hash(inputs.join('\n')).toString(HASH_RADIX);
};

/** Generates (or reuses) the declaration mirror for one Svelte directory.
 *  Never throws: a project without svelte2tsx, or a component svelte2tsx
 *  can't declare, keeps the loose ambient types it had before. */
export type SvelteDeclarationsOptions = {
	projectRoot: string;
	svelteDirectory: string;
};

export const generateSvelteDeclarations = async ({
	projectRoot,
	svelteDirectory
}: SvelteDeclarationsOptions): Promise<SvelteDeclarationsResult> => {
	const svelteDir = resolve(projectRoot, svelteDirectory);
	const tsconfigPath = join(projectRoot, 'tsconfig.json');
	if (!existsSync(svelteDir))
		return {
			reason: `${svelteDirectory} does not exist`,
			status: 'unavailable'
		};
	if (!existsSync(tsconfigPath))
		return { reason: 'no tsconfig.json', status: 'unavailable' };
	const svelte2tsxPath = resolveFrom('svelte2tsx', projectRoot);
	const shimsPath = resolveFrom(
		'svelte2tsx/svelte-shims-v4.d.ts',
		projectRoot
	);
	if (!svelte2tsxPath || !shimsPath)
		return { reason: 'svelte2tsx is not installed', status: 'unavailable' };
	// The TypeScript svelte2tsx itself loads, so the write guard applies.
	const typescriptPath = resolveFrom('typescript', dirname(svelte2tsxPath));
	if (!typescriptPath)
		return { reason: 'typescript is not installed', status: 'unavailable' };

	const outDir = join(
		projectRoot,
		SVELTE_DECLARATIONS_ROOT,
		relative(projectRoot, svelteDir)
	);
	const fingerprint = fingerprintOf(svelteDir, tsconfigPath, svelte2tsxPath);
	const fingerprintPath = join(outDir, FINGERPRINT_FILE);
	if (
		existsSync(fingerprintPath) &&
		readFileSync(fingerprintPath, 'utf-8') === fingerprint
	)
		return { outDir, status: 'unchanged' };

	const startedAt = performance.now();
	// Emit beside the mirror, then swap it in, so a concurrent reader (the
	// editor, a parallel typecheck) never sees a half-written tree.
	const stagingDir = `${outDir}.staging-${process.pid}`;
	await rm(stagingDir, { force: true, recursive: true });
	const emitted = await runEmit(projectRoot, {
		shimsPath,
		stagingDir,
		svelte2tsxPath,
		svelteDir,
		tsconfigPath,
		typescriptPath
	});
	if (emitted.exitCode !== 0) {
		await rm(stagingDir, { force: true, recursive: true });

		return {
			reason:
				emitted.stderr || `svelte2tsx exited with ${emitted.exitCode}`,
			status: 'unavailable'
		};
	}
	await mkdir(stagingDir, { recursive: true });
	await writeFile(join(stagingDir, FINGERPRINT_FILE), fingerprint);
	await mkdir(dirname(outDir), { recursive: true });
	await rm(outDir, { force: true, recursive: true });
	await rename(stagingDir, outDir);

	return {
		durationMs: performance.now() - startedAt,
		outDir,
		status: 'generated'
	};
};

/** The `rootDirs` entries a tsconfig needs for the generated declarations to
 *  resolve: the project root and the mirror, relative to `fromDir`. */
export const svelteDeclarationRootDirs = (
	projectRoot: string,
	fromDir: string
) => [
	relative(fromDir, projectRoot) || '.',
	relative(fromDir, join(projectRoot, SVELTE_DECLARATIONS_ROOT))
];

/** Whether the project's own tsconfig (what editors read) lists the mirror
 *  in `rootDirs`. */
export const tsconfigHasSvelteDeclarationRoot = (rootDirs: unknown) =>
	Array.isArray(rootDirs) &&
	rootDirs.some(
		(entry) =>
			typeof entry === 'string' &&
			entry.replace(/^\.\//, '').replace(/\/$/, '') ===
				SVELTE_DECLARATIONS_ROOT
	);
