import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import type { BunPlugin } from 'bun';
import type TS from 'typescript';
import { logWarn } from '../utils/logger';
import { ts } from '../utils/lazyTypescript';

/* The server/client boundary, enforced where the browser bundles are made.
 *
 * Two things that used to be found by a browser rather than by the build:
 *
 * 1. A server module reaching a client bundle. There was no way to even
 *    say a module was server-only — `createServerOnlyPlugin` gives
 *    `import '@absolutejs/absolute/server-only'` (src/serverOnly.ts) its
 *    teeth by failing the pass that resolved it, naming the importer.
 *
 * 2. `process.env.X` in client code. Bun does NOT inline it into a browser
 *    bundle, so nothing leaks — the reference survives verbatim and throws
 *    `ReferenceError: process is not defined` when the module evaluates.
 *    `createClientProcessEnvPlugin` turns that into a build diagnostic.
 *    `process.env.NODE_ENV` is the exception: Bun substitutes it in every
 *    browser bundle whether or not the pass defines it
 *    (src/build/resolveBuildMode.ts), so it neither crashes nor leaks.
 *
 * Both ride the existing pass machinery: a plugin that throws becomes a
 * build error in `result.logs`, which `extractBuildError` fails the build
 * on in production and `buildPassError` records in dev
 * (src/core/build.ts). That is also why the process.env check defaults to
 * a warning in dev: one offending module would otherwise fail its whole
 * pass and take every page in it down, which is a worse trade than the
 * runtime error the check exists to pre-empt. `absolute build` — and so
 * CI, and so anything about to be deployed — still fails hard. */

export type ClientProcessEnvMode = 'error' | 'off' | 'warn';

/** One unguarded `process.env` reference in a browser-bound module. */
export type ClientProcessEnvReference = {
	/** 1-based, for an editor. */
	column: number;
	/** `process.env.API_URL`, or `process.env` for a computed or whole-object
	 *  read (`process.env[name]`, `{ ...process.env }`). */
	key: string;
	/** 1-based, for an editor. */
	line: number;
};

/** Bun substitutes this one in every browser bundle, with or without a
 *  `define` entry for it. */
const SUBSTITUTED_KEY = 'process.env.NODE_ENV';

const SOURCE_FILTER = /\.[cm]?[jt]sx?$/;

/** The marker itself, plus the bare specifier Next.js uses for the same
 *  idea — a project moving over gets this message instead of "Could not
 *  resolve", which says nothing about why. */
const SERVER_ONLY_FILTER =
	/^(?:@absolutejs\/absolute\/server-only|server-only)$/;

const scriptKindFor = (fileName: string) => {
	if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
	if (/\.[cm]?ts$/.test(fileName)) return ts.ScriptKind.TS;

	return ts.ScriptKind.JS;
};

/** The `process.env` of `process.env.FOO` — the inner member expression,
 *  so each reference is counted once however it is then indexed. */
const isProcessEnv = (node: TS.Node) =>
	ts.isPropertyAccessExpression(node) &&
	ts.isIdentifier(node.expression) &&
	node.expression.text === 'process' &&
	node.name.text === 'env';

/** `process.env.FOO` and `process.env['FOO']` both read as the key a
 *  `define` entry would name. Anything else (a computed key, or the object
 *  itself) has no single key to match. */
const referenceKey = (node: TS.Node) => {
	const { parent } = node;
	if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
		return `process.env.${parent.name.text}`;
	if (
		ts.isElementAccessExpression(parent) &&
		parent.expression === node &&
		ts.isStringLiteralLike(parent.argumentExpression)
	)
		return `process.env.${parent.argumentExpression.text}`;

	return 'process.env';
};

const isLogicalOperator = (kind: TS.SyntaxKind) =>
	kind === ts.SyntaxKind.AmpersandAmpersandToken ||
	kind === ts.SyntaxKind.BarBarToken ||
	kind === ts.SyntaxKind.QuestionQuestionToken;

/** The condition an enclosing construct tests, when it tests one. An
 *  `if` keeps its condition in `expression`, not `condition` — which is
 *  the field a ternary uses. */
const conditionOf = (node: TS.Node) => {
	if (ts.isIfStatement(node)) return node.expression;
	if (ts.isConditionalExpression(node)) return node.condition;
	if (
		ts.isBinaryExpression(node) &&
		isLogicalOperator(node.operatorToken.kind)
	)
		return node.left;

	return undefined;
};

/* The globals whose `typeof` tells server from browser. `typeof process`
 * is the documented guard; `typeof window` and `typeof document` are the
 * other way code commonly asks the same question:
 *
 *     const base = typeof window !== 'undefined'
 *         ? window.location.origin
 *         : process.env.SITE_URL;
 */
const ENVIRONMENT_GLOBALS = new Set(['document', 'process', 'window']);

/** True when the subtree tests `typeof` of a global that tells server from
 *  browser (`process`, `window`, `document`). */
const testsTypeofProcess = (node: TS.Node): boolean => {
	if (
		ts.isTypeOfExpression(node) &&
		ts.isIdentifier(node.expression) &&
		ENVIRONMENT_GLOBALS.has(node.expression.text)
	)
		return true;

	return node.forEachChild(testsTypeofProcess) ?? false;
};

/** A statement that cannot fall through to the code after it. */
const exits = (statement: TS.Statement): boolean => {
	if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement))
		return true;

	return ts.isBlock(statement) ? statement.statements.some(exits) : false;
};

/* The other shape a guard takes, and the one the code this check first
 * found the bug in was written in:
 *
 *     if (typeof process === 'undefined') return [];
 *     cached ??= Object.entries(process.env)…
 *
 * The read is not inside the `if`, so the ancestor walk alone cannot see
 * it. An earlier version of this check reported it, on the grounds that
 * over-reporting is the safe direction — until `src/utils/serverSecrets.ts`
 * was fixed in exactly this shape and tripped it. A check that makes the
 * most natural way to write the guard look like a defect is a check people
 * turn off, so it is recognised: an `if` with no `else`, testing `typeof
 * process`, whose branch leaves, positioned before the read in an
 * enclosing statement list.
 *
 * Mildly lenient, deliberately: an early return in an *outer* function
 * exempts a read inside a nested closure that may be called from
 * elsewhere. Resolving that needs to know who calls the closure, which is
 * past what a per-file scan can answer. */
const guardedByEarlyReturn = (node: TS.Node, start: number) => {
	if (!ts.isBlock(node) && !ts.isSourceFile(node)) return false;

	return node.statements.some(
		(statement) =>
			statement.end <= start &&
			ts.isIfStatement(statement) &&
			statement.elseStatement === undefined &&
			testsTypeofProcess(statement.expression) &&
			exits(statement.thenStatement)
	);
};

/* A `typeof process` test enclosing the read, or leaving before it, means
 * the author wrote code that works in both places — the documented way to
 * keep an environment read. Structural either way: a bare `typeof process`
 * somewhere else in the file guards nothing and is not accepted. */
const guardedByTypeofProcess = (
	node: TS.Node | undefined,
	start: number
): boolean => {
	if (node === undefined) return false;
	const condition = conditionOf(node);
	if (condition !== undefined && testsTypeofProcess(condition)) return true;
	if (guardedByEarlyReturn(node, start)) return true;

	return guardedByTypeofProcess(node.parent, start);
};

type ScanOptions = {
	/** The pass's `define`. A key it substitutes never reaches the browser
	 *  as a `process` read. */
	define?: Record<string, string>;
	fileName: string;
	source: string;
};

/** Every unguarded `process.env` read in one browser-bound module.
 *
 *  Parsed rather than matched: a string, a comment or a template literal
 *  holding the text `process.env` is not a reference, and the repo has
 *  already shipped one bug from a text scan that could not tell the
 *  difference (maskLiterals.ts). The substring pre-check keeps the parser
 *  off the overwhelming majority of files, which never mention it. */
export const findClientProcessEnv = ({
	define = {},
	fileName,
	source
}: ScanOptions) => {
	const found: ClientProcessEnvReference[] = [];
	if (!source.includes('process.env')) return found;
	const tree = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKindFor(fileName)
	);
	const collect = (node: TS.Node) => {
		const key = isProcessEnv(node) ? referenceKey(node) : undefined;
		const start = key === undefined ? 0 : node.getStart(tree);
		if (
			key !== undefined &&
			key !== SUBSTITUTED_KEY &&
			define[key] === undefined &&
			!guardedByTypeofProcess(node.parent, start)
		) {
			const { character, line } =
				tree.getLineAndCharacterOfPosition(start);
			found.push({ column: character + 1, key, line: line + 1 });
		}
		node.forEachChild(collect);
	};
	collect(tree);

	return found;
};

const displayPath = (path: string, projectRoot: string) => {
	const inside = relative(projectRoot, path);

	return inside.startsWith('..') ? path : inside;
};

/* A `.vue`/`.svelte`/Angular component is bundled from the compiled copy
 * under `.absolutejs/generated/<framework>/`, so that is the path the scan
 * can report a line in. Say where it came from, or the message points at a
 * file the author never wrote. */
const GENERATED_FRAMEWORKS: Record<string, string> = {
	angular: 'Angular',
	ember: 'Ember',
	react: 'React',
	svelte: 'Svelte',
	vue: 'Vue'
};

const compiledFromNote = (path: string, generatedRoot: string) => {
	const inside = relative(generatedRoot, path);
	if (inside.startsWith('..')) return '';
	const framework = GENERATED_FRAMEWORKS[inside.split(sep)[0] ?? ''];

	return framework === undefined
		? ''
		: ` This file is the compiled copy of one of your ${framework} components — the reference is in that component's source.`;
};

export type ClientProcessEnvPluginOptions = {
	define?: Record<string, string>;
	/** `<projectRoot>/.absolutejs/generated`, for the compiled-copy note. */
	generatedRoot: string;
	mode: Exclude<ClientProcessEnvMode, 'off'>;
	projectRoot: string;
};

export const clientProcessEnvMessage = (
	path: string,
	references: readonly ClientProcessEnvReference[],
	{ generatedRoot, projectRoot }: ClientProcessEnvPluginOptions
) => {
	const where = references
		.map(
			(reference) =>
				`${reference.key} (${reference.line}:${reference.column})`
		)
		.join(', ');

	return `[absolutejs] ${displayPath(path, projectRoot)} reads process.env in client code: ${where}. Bun does not inline it into a browser bundle, so the reference survives and throws "ReferenceError: process is not defined" when the module evaluates.${compiledFromNote(path, generatedRoot)} Read the value on the server and pass it through the page's props, or test for it with \`typeof process !== 'undefined'\`. To turn this check off, set \`clientBoundary: { processEnv: 'off' }\` in absolute.config.ts.`;
};

/** Skipped: a dependency (its `process.env` is guarded or already
 *  substituted, and is not the author's to fix) and anything outside the
 *  project.
 *
 *  Compared against the project root's REAL path. Bun hands a plugin the
 *  resolved path of each module, so a project reached through a symlink
 *  (`/var/…` for macOS's `/private/var/…`, a linked workspace package)
 *  would otherwise look like it sat outside itself and every file would be
 *  skipped — a check that silently does nothing, which is the failure mode
 *  worth engineering against. */
const realRoot = (projectRoot: string) => {
	try {
		return realpathSync(projectRoot);
	} catch {
		return projectRoot;
	}
};

const isProjectSource = (path: string, projectRoot: string) =>
	!path.includes(`${sep}node_modules${sep}`) &&
	!relative(projectRoot, path).startsWith('..');

/** Reports unguarded `process.env` reads in the project's own
 *  browser-bound modules. Read-only: it never takes over loading, so a
 *  file it looks at is still loaded by Bun exactly as before. */
export const createClientProcessEnvPlugin = (
	options: ClientProcessEnvPluginOptions
): BunPlugin => ({
	name: 'absolute-client-process-env',
	setup(build) {
		const root = realRoot(options.projectRoot);
		build.onLoad({ filter: SOURCE_FILTER }, async (args) => {
			if (!isProjectSource(args.path, root)) return undefined;
			const references = findClientProcessEnv({
				define: options.define,
				fileName: args.path,
				source: await Bun.file(args.path).text()
			});
			if (references.length === 0) return undefined;
			const message = clientProcessEnvMessage(args.path, references, {
				...options,
				projectRoot: root
			});
			if (options.mode === 'error') throw new Error(message);
			logWarn(message);

			return undefined;
		});
	}
});

/** The installed package a path belongs to, for an importer inside
 *  `node_modules` — `@scope/name` or `name`. */
const packageOf = (path: string) => {
	const segments = path.split(`${sep}node_modules${sep}`).at(-1)?.split(sep);
	if (segments === undefined) return undefined;
	const [first, second] = segments;
	if (first === undefined) return undefined;

	return first.startsWith('@') && second !== undefined
		? `${first}/${second}`
		: first;
};

/* The advice differs by who wrote the import. A dependency that drags the
 * marker into a browser bundle is the package's bug, not something to go
 * and refactor in the project's own code, and saying "follow the imports
 * from your page" would send someone looking for a file they do not have. */
export const serverOnlyMessage = (importer: string, projectRoot: string) => {
	const preamble = `[absolutejs] A browser bundling pass resolved an import of "@absolutejs/absolute/server-only", which marks a module that must not be part of a browser bundle.`;
	const dependency = importer.includes(`${sep}node_modules${sep}`)
		? packageOf(importer)
		: undefined;
	if (dependency !== undefined)
		return `${preamble} The import is in ${dependency} (${importer}), so this is that package's own server/client split rather than something to fix in your code: import it only from server code, or report it upstream.`;

	return `${preamble} The import is in ${displayPath(importer, projectRoot) || 'a client entry point'}. Follow the imports from your page's client entry to that module: move the server-only work into a route handler or a form action, and pass what the page needs through its props.`;
};

/** Fails a browser pass that resolves the server-only marker.
 *
 *  Matching the specifier rather than the resolved file is deliberate: it
 *  fires before resolution, so it reports the same way whether or not the
 *  package's `browser` export condition is in play, and `args.importer` is
 *  the file to go and edit. */
export const createServerOnlyPlugin = (projectRoot: string): BunPlugin => ({
	name: 'absolute-server-only',
	setup(build) {
		const root = realRoot(projectRoot);
		build.onResolve({ filter: SERVER_ONLY_FILTER }, (args) => {
			throw new Error(serverOnlyMessage(args.importer, root));
		});
	}
});

/** `'error'` before a deploy, `'warn'` while developing — see the note at
 *  the top of this file on why dev does not fail the pass.
 *
 *  Keyed on the dev server (`options.injectHMR`) rather than on the
 *  resolved development mode, so it lines up exactly with the passes that
 *  degrade instead of aborting in `src/core/build.ts`. `absolute build`
 *  never sets it, whatever the ambient NODE_ENV says. */
export const resolveClientProcessEnvMode = (
	configured: ClientProcessEnvMode | undefined,
	isDevServer: boolean
) => configured ?? (isDevServer ? 'warn' : 'error');
