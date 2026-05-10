/* Persistent Tailwind v4 compiler for incremental dev rebuilds.

   The naive path (re-running bun.build with bun-plugin-tailwind) pays the
   bundler init cost on every HMR tick. For a dev workflow where most edits
   only add or remove a few utility classes, that's wasted work — Tailwind v4
   has a per-candidate cache built into its compiler, but only if you keep
   the compiler instance alive.

   This module mirrors the strategy used by @tailwindcss/vite: hold one
   compiled instance keyed by the input CSS path, scan only changed files
   for new candidate tokens, and call `compiler.build(allCandidates)` to
   produce CSS. Tailwind reuses its internal cache for candidates it has
   already compiled, so the marginal cost per HMR is just the file scan
   plus CSS serialization.

   We also content-hash the emitted CSS and skip the broadcast (and the
   disk write) when it hasn't changed — this avoids needless browser
   stylesheet refetches when an edit doesn't add/remove any utilities. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { compileStyleSource } from './stylePreprocessor';
import type {
	StylePreprocessorConfig,
	TailwindConfig
} from '../../types/build';

type TailwindCompile = typeof import('tailwindcss').compile;
type TailwindCompiler = Awaited<ReturnType<TailwindCompile>>;
type TailwindSource = TailwindCompiler['sources'][number];

type CompilerEntry = {
	compiler: TailwindCompiler;
	cssPath: string;
	cssMtimeMs: number;
	sources: TailwindSource[];
	/* Every CSS file the compiler pulled in via @import (the input CSS
	   itself plus anything it transitively loaded). If one of these changes,
	   the parsed AST is stale and we have to rebuild the compiler — Tailwind
	   only resolves imports once at compile() time. */
	cssDependencies: Map<string, number>;
	/* Ref-counted union of candidates across the whole source tree. We
	   count rather than track presence so that a class still referenced by
	   another file isn't dropped when it disappears from one. */
	candidateCounts: Map<string, number>;
	perFileCandidates: Map<string, Set<string>>;
	lastEmittedHash: string | null;
};

/* Cache one compiler per absolute input-CSS path. Multiple entries are
   possible if a project ever wires more than one Tailwind input, though in
   practice there's usually just one. */
const compilerCache = new Map<string, CompilerEntry>();

let cachedTailwindCompile: TailwindCompile | null = null;

const loadTailwindCompile = async () => {
	if (cachedTailwindCompile) return cachedTailwindCompile;
	try {
		const mod = await import('tailwindcss');

		cachedTailwindCompile = mod.compile;

		return mod.compile;
	} catch {
		throw new Error(
			'Tailwind incremental dev compiler requires `tailwindcss` to be installed.'
		);
	}
};

const recordDependency = async (deps: Map<string, number>, path: string) => {
	try {
		const mtime = (await stat(path)).mtimeMs;
		deps.set(path, mtime);
	} catch {
		deps.set(path, 0);
	}
};

/* Resolve a bare specifier (e.g. `tailwindcss`) to its CSS entry point.

   Bun's default resolver follows the `import` / `require` conditions and
   would hand back the package's JS entry (e.g. `tailwindcss/dist/lib.mjs`).
   Tailwind's `@import "tailwindcss"` is a *CSS* import — it needs the
   `style` exports condition (or a sensible fallback) instead.

   The strategy:
   1. Resolve `<id>/package.json` to find the package directory.
   2. Look at `exports["."].style` — Tailwind v4 sets this; it's the
      modern way to expose a CSS entry from a package.
   3. Fall back to the legacy top-level `style` field.
   4. Fall back to common file conventions (`index.css`, `dist/index.css`).

   Anything not in that shape (subpath imports like `tailwindcss/preflight`)
   falls through to Bun's regular resolver, which handles `.css` subpaths
   correctly. */
const resolveBareCssImport = (id: string, base: string) => {
	const slashIndex = id.indexOf('/');
	const pkgName = id.startsWith('@')
		? id.split('/').slice(0, 2).join('/')
		: slashIndex === -1
			? id
			: id.slice(0, slashIndex);
	const subpath = id.slice(pkgName.length);

	if (subpath !== '') {
		return Bun.resolveSync(id, base);
	}

	let pkgJsonPath: string;
	try {
		pkgJsonPath = Bun.resolveSync(`${pkgName}/package.json`, base);
	} catch {
		return Bun.resolveSync(id, base);
	}

	const pkgDir = dirname(pkgJsonPath);
	let pkg: Record<string, unknown> = {};
	try {
		pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
	} catch {
		return Bun.resolveSync(id, base);
	}

	const exportsField = pkg.exports as
		| { '.'?: { style?: string } }
		| undefined;
	const styleFromExports = exportsField?.['.']?.style;
	const candidates = [
		styleFromExports,
		typeof pkg.style === 'string' ? pkg.style : undefined,
		'index.css',
		'dist/index.css'
	].filter((entry): entry is string => typeof entry === 'string');

	for (const candidate of candidates) {
		const candidatePath = resolve(pkgDir, candidate);
		if (existsSync(candidatePath)) return candidatePath;
	}

	return Bun.resolveSync(id, base);
};

/* Resolve `@import` and `@source` paths relative to the importing file.
   The factory closes over the dependency map so every imported stylesheet
   is tracked for change detection. */
const createLoadStylesheet =
	(deps: Map<string, number>) => async (id: string, base: string) => {
		const path =
			id.startsWith('.') || isAbsolute(id)
				? resolve(base, id)
				: resolveBareCssImport(id, base);
		const content = await readFile(path, 'utf-8');
		await recordDependency(deps, path);

		return { base: dirname(path), content, path };
	};

const loadModule = async (
	id: string,
	base: string,
	_kind: 'plugin' | 'config'
) => {
	const path =
		id.startsWith('.') || isAbsolute(id)
			? resolve(base, id)
			: Bun.resolveSync(id, base);
	const module = await import(path);

	return { base: dirname(path), module, path };
};

const buildCompilerEntry = async (
	cssPath: string,
	extraSources: string[] = []
): Promise<CompilerEntry> => {
	const compile = await loadTailwindCompile();
	const absPath = resolve(cssPath);
	const userCss = await readFile(absPath, 'utf-8');
	const cssMtimeMs = (await stat(absPath)).mtimeMs;
	const cssDependencies = new Map<string, number>();
	cssDependencies.set(absPath, cssMtimeMs);
	// Prepend `@source` directives for each framework directory the
	// user configured. Without this, users have to remember to add a
	// `@source "../angular/**/*.{ts,html}"` line to their tailwind.css
	// for every framework dir — easy to forget and breaks silently
	// (utilities used in components don't show up in the emitted CSS,
	// markup looks unstyled). The paths are absolute so the `base`
	// dir of the user's tailwind.css doesn't matter.
	const sourceDirectives = extraSources
		.map((pattern) => `@source ${JSON.stringify(pattern)};`)
		.join('\n');
	const css = sourceDirectives
		? `${sourceDirectives}\n${userCss}`
		: userCss;
	const compiler = await compile(css, {
		base: dirname(absPath),
		loadModule,
		loadStylesheet: createLoadStylesheet(cssDependencies)
	});

	return {
		candidateCounts: new Map<string, number>(),
		compiler,
		cssDependencies,
		cssMtimeMs,
		cssPath: absPath,
		lastEmittedHash: null,
		perFileCandidates: new Map(),
		sources: [...compiler.sources]
	};
};

/* Permissive candidate extractor — matches anything that *could* be a
   Tailwind utility class. The compiler discards inputs that don't resolve
   to real utilities, so a superset is fine.

   The class character set covers v4 syntax including:
   - variants  : `hover:`, `dark:`, `md:`, `data-[open]:`
   - modifiers : `text-blue/50`
   - arbitraries: `bg-[var(--c)]`, `min-h-[260px]`, `bg-[#fff]`
   - negation  : `-mx-4`, `!important`
   - groups    : `group-hover:opacity-50`

   Tokens must start with a letter / `-` / `!` (so we don't pull in pure
   numbers) and end with a word char or `]` or `)` (so we don't include
   trailing punctuation). */
const CANDIDATE_PATTERN = /[A-Za-z!\-_][\w:\-/[\]().!,#%@&]*[\w\])]/g;

export const extractCandidates = (source: string) => {
	const out = new Set<string>();
	for (const match of source.matchAll(CANDIDATE_PATTERN)) {
		out.add(match[0]);
	}

	return out;
};

const hashCss = (css: string) => createHash('sha1').update(css).digest('hex');

// Match a file path against a Tailwind `@source` pattern.
//
// Tailwind hands us sources as { base, pattern, negated } where pattern
// is interpreted relative to base and may contain `..` segments to walk
// up the tree. `path.resolve(base, pattern)` collapses the `..` while
// leaving the glob metacharacters intact, giving us an absolute glob
// pattern that we can match against the absolute file path directly —
// no prefix-and-substring dance, no glob-aware path walking.
const fileMatchesSources = (file: string, sources: TailwindSource[]) => {
	if (sources.length === 0) return true;
	const absFile = resolve(file);
	for (const source of sources) {
		if (source.negated) continue;
		const absolutePattern = resolve(source.base, source.pattern);
		// A literal `@source "./foo.html"` (no glob metachars) just needs
		// path equality, not Bun.Glob matching.
		if (!/[*?{[]/.test(absolutePattern)) {
			if (absolutePattern === absFile) return true;
			continue;
		}
		const glob = new Bun.Glob(absolutePattern);
		if (glob.match(absFile)) return true;
	}

	return false;
};

const incrementCandidateCount = (entry: CompilerEntry, candidate: string) => {
	const current = entry.candidateCounts.get(candidate) ?? 0;
	entry.candidateCounts.set(candidate, current + 1);
};

const decrementCandidateCount = (entry: CompilerEntry, candidate: string) => {
	const current = entry.candidateCounts.get(candidate) ?? 0;
	const next = current - 1;
	if (next <= 0) {
		entry.candidateCounts.delete(candidate);

		return;
	}
	entry.candidateCounts.set(candidate, next);
};

const replaceFileCandidates = (
	entry: CompilerEntry,
	file: string,
	freshCandidates: Set<string>
) => {
	const previous = entry.perFileCandidates.get(file);
	if (previous) {
		for (const candidate of previous)
			decrementCandidateCount(entry, candidate);
	}
	entry.perFileCandidates.set(file, freshCandidates);
	for (const candidate of freshCandidates)
		incrementCandidateCount(entry, candidate);
};

// Split an absolute glob like /abs/src/frontend/<glob> into a literal
// scan root (/abs/src/frontend) and a relative glob portion. Bun.Glob.scan
// needs a real directory as `cwd`; passing a glob there silently scans
// nothing.
const splitGlobAtFirstMeta = (absolutePattern: string) => {
	const firstMetaIndex = absolutePattern.search(/[*?{[]/);
	if (firstMetaIndex === -1) {
		return { glob: '', root: absolutePattern };
	}
	const lastSlashBeforeMeta = absolutePattern.lastIndexOf(
		'/',
		firstMetaIndex
	);

	return {
		glob: absolutePattern.slice(lastSlashBeforeMeta + 1),
		root: absolutePattern.slice(0, lastSlashBeforeMeta) || '/'
	};
};

const collectFilesForSources = async (sources: TailwindSource[]) => {
	const seen = new Set<string>();
	const collected: string[] = [];
	const scans = sources
		.filter((source) => !source.negated)
		.map(async (source) => {
			const absolutePattern = resolve(source.base, source.pattern);
			const { glob: relativePattern, root } =
				splitGlobAtFirstMeta(absolutePattern);
			// Literal source path (no glob metachars) — Tailwind v4 lets
			// `@source "./foo.html"` reference a single file, so just
			// return it directly if it exists.
			if (!relativePattern) {
				try {
					const stats = await stat(absolutePattern);
					return stats.isFile() ? [absolutePattern] : [];
				} catch {
					return [];
				}
			}
			const glob = new Bun.Glob(relativePattern);
			const matches: string[] = [];
			for await (const relative of glob.scan({
				absolute: false,
				cwd: root,
				onlyFiles: true
			})) {
				matches.push(resolve(root, relative));
			}

			return matches;
		});
	const results = await Promise.all(scans);
	for (const absolute of results.flat()) {
		if (seen.has(absolute)) continue;
		seen.add(absolute);
		collected.push(absolute);
	}

	return collected;
};

const ingestFile = async (entry: CompilerEntry, absolute: string) => {
	try {
		const text = await readFile(absolute, 'utf-8');
		replaceFileCandidates(entry, absolute, extractCandidates(text));
	} catch {
		// File vanished between glob and read — skip silently.
	}
};

const populateCandidatesFromAllSources = async (entry: CompilerEntry) => {
	const files = await collectFilesForSources(entry.sources);
	await Promise.all(files.map((file) => ingestFile(entry, file)));
};

const isCompilerStale = async (entry: CompilerEntry) => {
	const checks = [...entry.cssDependencies.entries()].map(
		async ([path, knownMtime]) => {
			try {
				const mtime = (await stat(path)).mtimeMs;

				return mtime !== knownMtime;
			} catch {
				return true;
			}
		}
	);
	const results = await Promise.all(checks);

	return results.some(Boolean);
};

const getCompilerEntry = async (
	cssPath: string,
	extraSources: string[] = []
) => {
	const key = resolve(cssPath);
	const cached = compilerCache.get(key);
	if (cached && !(await isCompilerStale(cached))) return cached;

	const fresh = await buildCompilerEntry(cssPath, extraSources);
	await populateCandidatesFromAllSources(fresh);
	compilerCache.set(key, fresh);

	return fresh;
};

/* Drop the cached compiler — used when the dev server stops or the
   Tailwind input CSS itself changes and needs a full re-parse. */
export const disposeTailwindCompiler = (cssPath?: string) => {
	if (!cssPath) {
		compilerCache.clear();

		return;
	}
	compilerCache.delete(resolve(cssPath));
};

/* Run a fast incremental Tailwind build. Returns whether the emitted CSS
   actually changed — callers can use that to skip the broadcast. */
export const incrementalTailwindBuild = async (
	tailwind: TailwindConfig,
	buildPath: string,
	changedFiles: string[],
	styleTransformConfig?: StylePreprocessorConfig,
	extraSources: string[] = []
) => {
	const startedAt = performance.now();
	const entry = await getCompilerEntry(tailwind.input, extraSources);
	const inputAbs = entry.cssPath;
	const filesToRescan: string[] = [];

	for (const file of changedFiles) {
		const abs = resolve(file);
		if (abs === inputAbs) continue;
		if (!fileMatchesSources(abs, entry.sources)) continue;
		filesToRescan.push(abs);
	}

	await Promise.all(filesToRescan.map((file) => ingestFile(entry, file)));

	const rawCss = entry.compiler.build([...entry.candidateCounts.keys()]);
	const outputPath = resolve(buildPath, tailwind.output);
	const finalCss = await compileStyleSource(
		outputPath,
		rawCss,
		'css',
		styleTransformConfig
	);
	const hash = hashCss(finalCss);
	const durationMs = performance.now() - startedAt;

	if (hash === entry.lastEmittedHash) {
		return { cssChanged: false, durationMs };
	}

	await Bun.write(outputPath, finalCss);
	entry.lastEmittedHash = hash;

	return { cssChanged: true, durationMs };
};

/* Pre-build the compiler at dev startup so the first HMR tick doesn't
   pay the parse-and-scan cost. Safe to call multiple times — it's a no-op
   once cached. */
export const warmTailwindCompiler = async (
	tailwind: TailwindConfig,
	extraSources: string[] = []
) => {
	await getCompilerEntry(tailwind.input, extraSources);
};
