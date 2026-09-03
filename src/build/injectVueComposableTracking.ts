/** Dev-only Vue composable state tracking for bundled client output.
 *
 *  The first HMR cycle of a Vue page starts from the BUNDLED graph (the
 *  hydration index / page bundle / shared chunks emitted by `Bun.build`), not
 *  from the dev module server. Every later cycle re-imports the edited
 *  composable through `/@src/...`, where `moduleServer.injectComposableTracking`
 *  wraps each `use*` export so ref values survive a reload. For that first
 *  cycle to preserve state too, the bundled copy of each composable has to
 *  record its refs under the SAME module id the module server will use —
 *  the absolute path of the composable's source file.
 *
 *  This pass finds every top-level `var useXxx = ...` in a bundled output,
 *  resolves the source file it came from (Bun prints a `// <path>` comment at
 *  each module boundary of unminified output), and wraps the initializer with
 *  `__hmr_wrap(<moduleId>, <name>, <fn>)`. With code splitting on, a
 *  composable shared by several pages lives in a `/chunk-*.js` file, so the
 *  pass runs over the page bundles AND every chunk they (transitively) import.
 *
 *  The statement end is located on `maskLiterals`-masked text: template
 *  literals and comments are opaque placeholders there, so Bun's formatting
 *  invariant ("nested code is indented, only top-level statements start at
 *  column 0") is enough to find the terminating `;` without parsing — no
 *  brace counting that a quote inside a comment or regex literal could
 *  desynchronise. A `use*` binding whose end cannot be located is left
 *  untouched rather than emitted half-wrapped. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { UNFOUND_INDEX } from '../constants';
import { maskLiterals, SENTINEL } from './maskLiterals';

export type VueComposableModuleIdOptions = {
	/** Directory Bun printed its module-boundary comments relative to. */
	projectRoot: string;
	/** Absolute path of the configured Vue directory (`vueDirectory`). */
	vueDir?: string;
	/** `<generatedRoot>/vue` — compileVue writes transpiled TS helpers to
	 *  `<generatedVueDir>/client/<path relative to vueDir>.js`. */
	generatedVueDir?: string;
};

type ModuleComment = { index: number; path: string };

type ComposableDeclaration = {
	name: string;
	/** Offset of `var useX = `. */
	start: number;
	/** Offset just past `var useX = ` — where the initializer begins. */
	exprStart: number;
};

type ModuleIdResolver = (commentPath: string | undefined) => string;

const VUE_HMR_RUNTIME = [
	`var __hmr_cs=(globalThis.__HMR_COMPOSABLE_STATE__??={});`,
	`var __hmr_prev={};`,
	`var __hmr_idx={};`,
	`function __hmr_wrap(m,n,fn){`,
	`if(typeof fn!=="function")return fn;`,
	`if(!(m in __hmr_prev)){__hmr_prev[m]=__hmr_cs[m];__hmr_cs[m]={};}`,
	`return function(){`,
	`var k=m+"\\0"+n;var i=(__hmr_idx[k]=(__hmr_idx[k]??-1)+1);`,
	`var r=fn.apply(this,arguments);`,
	`if(r&&typeof r==="object"){`,
	`var refs={};for(var p in r){var v=r[p];`,
	`if(v&&typeof v==="object"&&"value"in v&&!v.effect&&typeof v.value!=="function")refs[p]=v;}`,
	`(__hmr_cs[m][n]??=[])[i]=refs;`,
	`var pr=__hmr_prev[m];`,
	`if(pr&&pr[n]&&pr[n][i]){var old=pr[n][i];`,
	`for(var p in old){var nv=r[p],ov=old[p];`,
	`if(nv&&ov&&typeof nv==="object"&&"value"in nv&&!nv.effect&&typeof nv.value===typeof ov.value)nv.value=ov.value;}`,
	`}}return r;};}`
].join('');

/** Top-level composable declaration as Bun prints it in unminified ESM
 *  output. Exported bindings are hoisted to `var` and re-exported at the
 *  bottom of the file, so this also covers `export const useX = ...`. */
const USE_DECLARATION = /^var\s+(use[A-Z]\w*)\s*=\s*/gm;

/** Bun's module-boundary comment (`// src/composables/useCount.ts`). Only a
 *  path-like line qualifies so a stray column-0 comment can't be mistaken
 *  for one. */
const MODULE_COMMENT = /^\/\/ (\S+\.(?:[cm]?[jt]sx?|vue))\r?$/gm;

/** Statement terminator: a line whose last code char is `;` (a masked
 *  trailing comment placeholder may follow). */
const LINE_TERMINATOR = new RegExp(
	`;\\s*(?://${SENTINEL}\\d+${SENTINEL})?\\s*$`
);

/** A column-0 line opening a new statement or module comment. */
const STATEMENT_OPENER = /^[A-Za-z_$/]/;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'];

/** Any `./chunk-x.js` / `../../chunk-x.js` reference — static, side-effect
 *  or dynamic import — as Bun prints them between split outputs. */
const CHUNK_REFERENCE = /["'](?:\.\.?\/)+(chunk-[A-Za-z0-9_-]+\.js)["']/g;

const isSharedChunkFile = (fileName: string) =>
	fileName.startsWith('chunk-') && fileName.endsWith('.js');

const collectModuleComments = (content: string) =>
	Array.from(content.matchAll(MODULE_COMMENT), (match) => ({
		index: match.index,
		path: match[1] ?? ''
	})).filter((comment): comment is ModuleComment => comment.path !== '');

const collectDeclarations = (content: string) =>
	Array.from(content.matchAll(USE_DECLARATION), (match) => ({
		exprStart: match.index + match[0].length,
		name: match[1] ?? '',
		start: match.index
	})).filter(
		(declaration): declaration is ComposableDeclaration =>
			declaration.name !== ''
	);

const lastCommentBefore = (comments: ModuleComment[], offset: number) => {
	let last: ModuleComment | undefined;
	for (const comment of comments) {
		if (comment.index > offset) break;
		last = comment;
	}

	return last?.path;
};

/** Composable name → the module-boundary comment path it was printed under
 *  (the closest comment above the declaration). */
const mapComposablesToSourceComments = (content: string) => {
	const comments = collectModuleComments(content);
	const sourceByName = new Map<string, string | undefined>();
	for (const declaration of collectDeclarations(content)) {
		sourceByName.set(
			declaration.name,
			lastCommentBefore(comments, declaration.start)
		);
	}

	return sourceByName;
};

const classifyLine = (line: string, isFirstLine: boolean) => {
	const firstChar = line[0] ?? '';
	if (firstChar === ' ' || firstChar === '\t') return 'nested';
	if (LINE_TERMINATOR.test(line)) return 'end';
	if (!isFirstLine && STATEMENT_OPENER.test(firstChar)) return 'stop';

	return 'nested';
};

/** Wrap one declaration's initializer in `__hmr_wrap(...)`, or return the
 *  text unchanged when its statement end cannot be located. */
const wrapDeclaration = (
	text: string,
	declaration: ComposableDeclaration,
	moduleId: string
) => {
	const end = findTopLevelStatementEnd(text, declaration.exprStart);
	if (end === UNFOUND_INDEX || end <= declaration.exprStart) return text;
	const expression = text.slice(declaration.exprStart, end);
	if (expression.trim() === '') return text;

	return `${text.slice(0, declaration.exprStart)}__hmr_wrap(${JSON.stringify(moduleId)}, ${JSON.stringify(declaration.name)}, ${expression})${text.slice(end)}`;
};

/** The Vue page bundles plus every shared chunk reachable from them through
 *  chunk imports. Chunks only reachable from other frameworks' entries are
 *  skipped. Chunk contents are read once here; the injection pass re-reads
 *  only the files it is about to rewrite. */
export const collectVueHmrOutputPaths = (
	vueOutputPaths: string[],
	chunkOutputPaths: string[]
) => {
	const chunkByName = new Map(
		chunkOutputPaths
			.filter(isSharedChunkPath)
			.map((path) => [basename(path), path] as const)
	);
	const selected = new Set(vueOutputPaths);
	if (chunkByName.size === 0) return [...selected];

	const readChunkReferences = (path: string) => {
		try {
			return Array.from(
				readFileSync(path, 'utf-8').matchAll(CHUNK_REFERENCE),
				(match) => match[1] ?? ''
			);
		} catch {
			return [];
		}
	};
	const visit = (path: string) => {
		for (const chunkName of readChunkReferences(path)) {
			const chunkPath = chunkByName.get(chunkName);
			if (!chunkPath || selected.has(chunkPath)) continue;
			selected.add(chunkPath);
			visit(chunkPath);
		}
	};
	vueOutputPaths.forEach(visit);

	return [...selected];
};

/** Index of the `;` that ends the top-level statement whose initializer
 *  starts at `start`, on masked text. Bun prints nested code indented, so
 *  the statement ends on the first line from `start` that begins at column
 *  0 (or is the starting line itself) and ends with `;`. A column-0 line
 *  that instead opens a new statement (`var`, `export`, a module comment)
 *  means the end could not be located: `-1`, and the caller leaves that
 *  binding alone. The only column-0 text inside an initializer would sit in
 *  a template literal or comment, both masked. */
export const findTopLevelStatementEnd = (text: string, start: number) => {
	let lineStart = text.lastIndexOf('\n', start - 1) + 1;
	let isFirstLine = true;
	while (lineStart < text.length) {
		const newline = text.indexOf('\n', lineStart);
		const lineEnd = newline === UNFOUND_INDEX ? text.length : newline;
		const line = text.slice(lineStart, lineEnd);
		const kind = classifyLine(line, isFirstLine);
		if (kind === 'end') return lineStart + line.lastIndexOf(';');
		if (kind === 'stop') return UNFOUND_INDEX;
		isFirstLine = false;
		lineStart = lineEnd + 1;
	}

	return UNFOUND_INDEX;
};

export const injectVueComposableTracking = (
	outputPath: string,
	options: VueComposableModuleIdOptions
) => {
	const content = readFileSync(outputPath, 'utf-8');
	const next = injectVueComposableTrackingIntoContent(
		content,
		(commentPath) =>
			commentPath
				? resolveVueComposableModuleId(commentPath, options)
				: outputPath
	);
	if (next !== content) writeFileSync(outputPath, next);
};

/** Pure transform: wrap every top-level `use*` initializer and prepend the
 *  tracking runtime. Returns the input unchanged when nothing qualifies. */
export const injectVueComposableTrackingIntoContent = (
	content: string,
	resolveModuleId: ModuleIdResolver
) => {
	const sourceByName = mapComposablesToSourceComments(content);
	if (sourceByName.size === 0) return content;

	const { masked, restore } = maskLiterals(content);
	const declarations = collectDeclarations(masked).filter((declaration) =>
		sourceByName.has(declaration.name)
	);
	if (declarations.length === 0) return content;

	// Walk back to front so earlier offsets stay valid after each splice.
	const wrapped = declarations.reduceRight(
		(text, declaration) =>
			wrapDeclaration(
				text,
				declaration,
				resolveModuleId(sourceByName.get(declaration.name))
			),
		masked
	);
	if (wrapped === masked) return content;

	const [firstDeclaration] = declarations;
	const insertAt = firstDeclaration?.start ?? 0;

	return restore(
		`${wrapped.slice(0, insertAt)}${VUE_HMR_RUNTIME}\n${wrapped.slice(insertAt)}`
	);
};

export const isSharedChunkPath = (path: string) =>
	isSharedChunkFile(basename(path));

/** Map a Bun module-boundary comment path to the module id the dev module
 *  server keys composable state by: the absolute source path. Transpiled TS
 *  helpers under `<generatedVueDir>/client/` map back to their source under
 *  `vueDir`; anything else (node_modules, other frameworks) resolves against
 *  the project root and simply never matches a served module. */
export const resolveVueComposableModuleId = (
	commentPath: string,
	options: VueComposableModuleIdOptions
) => {
	const absolutePath = resolve(options.projectRoot, commentPath);
	const { vueDir, generatedVueDir } = options;
	if (!vueDir || !generatedVueDir) return absolutePath;

	const withinGenerated = relative(generatedVueDir, absolutePath);
	if (
		withinGenerated === '' ||
		withinGenerated.startsWith('..') ||
		isAbsolute(withinGenerated)
	) {
		return absolutePath;
	}

	// compileVue mirrors `relative(vueDir, source)` under `<generated>/client`,
	// so a helper outside vueDir lands as `<generated>/<sibling>/x.js` — the
	// same relative walk from vueDir recovers its source location.
	const fromClientDir = relative(
		resolve(generatedVueDir, 'client'),
		absolutePath
	);
	const stem = resolve(vueDir, fromClientDir).replace(/\.[cm]?js$/, '');
	const existing = SOURCE_EXTENSIONS.map(
		(extension) => `${stem}${extension}`
	).find((candidate) => existsSync(candidate));

	return existing ?? `${stem}.ts`;
};
