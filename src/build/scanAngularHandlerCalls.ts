/* Build-time static analysis: find every `handleAngularPageRequest({...})`
 * call in the project's TypeScript sources and pull out two pieces of
 * metadata `compileAngular`'s providers-injection step needs:
 *
 *   - the manifest key from `pagePath: asset(manifest, "Home")` (used to
 *     match the call back to a page bundle), and
 *   - the parent Elysia route mount path from the surrounding
 *     `.get/.post/...` call (used to inject `APP_BASE_HREF` for
 *     sub-router pages like `/portal/*` → `/portal/`).
 *
 * Handler-call `providers:` extras are honoured at SSR request time
 * directly in `pageHandler.ts` — they don't need to be statically
 * analysed or bundled into the page output.
 *
 * Walks every project `.ts` file rather than tracing `.use(plugin)` from
 * a single entry — same approach `scanRouteRegistrations` takes. The
 * heuristic (`.method("/path", ...)` with a `handleAngularPageRequest(...)`
 * inside) is specific enough that the cheap pre-filter
 * (`source.includes('handleAngularPageRequest')`) skips most files
 * without ever creating a `ts.SourceFile`.
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

const ELYSIA_ROUTE_METHODS = new Set([
	'all',
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put'
]);

const SKIP_DIRS = new Set([
	'.absolutejs',
	'.generated',
	'.git',
	'.next',
	'.svelte-kit',
	'.vercel',
	'build',
	'compiled',
	'dist',
	'node_modules'
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SERVER_ENTRY_COPY_PREFIX = '.absolutejs-hmr-';

export type AngularHandlerCall = {
	/** File the call lives in. */
	sourceFile: string;
	/** Manifest key extracted from `pagePath: asset(manifest, "Foo")`. */
	manifestKey: string;
	/** Mount path from the surrounding `.get("/path", ...)` / `.post(...)`
	 *  Elysia chain. `null` when the call isn't directly inside such a
	 *  registration (rare but possible — e.g. inside a helper function).
	 *  The SSR handler then derives `APP_BASE_HREF` from the route Elysia
	 *  matched at request time instead (see `src/angular/baseHref.ts`). */
	mountPath: string | null;
};

const getScriptKind = (filePath: string) => {
	if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;

	return ts.ScriptKind.TS;
};

const hasSourceExtension = (filePath: string) => {
	const idx = filePath.lastIndexOf('.');
	if (idx === -1) return false;

	return SOURCE_EXTENSIONS.has(filePath.slice(idx));
};

const readEntries = (dir: string) => {
	try {
		return readdirSync(dir, { encoding: 'utf-8', withFileTypes: true });
	} catch {
		return [];
	}
};

const isScannedDirectory = (entry: Dirent) =>
	entry.isDirectory() &&
	!SKIP_DIRS.has(entry.name) &&
	!entry.name.startsWith('.');

const isScannedFile = (entry: Dirent) =>
	!entry.isDirectory() &&
	entry.isFile() &&
	!entry.name.startsWith(SERVER_ENTRY_COPY_PREFIX) &&
	hasSourceExtension(entry.name);

const collectSourceFiles = (root: string) => {
	const out: string[] = [];
	const stack: string[] = [root];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;
		const entries = readEntries(dir);
		entries
			.filter(isScannedDirectory)
			.forEach((entry) => stack.push(join(dir, entry.name)));
		entries
			.filter(isScannedFile)
			.forEach((entry) => out.push(join(dir, entry.name)));
	}

	return out;
};

const fileMayContainAngularHandler = (source: string) =>
	source.includes('handleAngularPageRequest');

/** Look for the manifest key string in something like
 *  `pagePath: asset(manifest, "Foo")`. Returns null if the value isn't
 *  shaped that way (e.g. dynamic computation). */
const extractManifestKey = (pagePathValue: TS.Expression) => {
	if (!ts.isCallExpression(pagePathValue)) return null;
	const callee = pagePathValue.expression;
	if (!ts.isIdentifier(callee) || callee.text !== 'asset') return null;
	const [, second] = pagePathValue.arguments;
	if (!second) return null;
	if (!ts.isStringLiteral(second)) return null;

	return second.text;
};

/* The path of `.method("/path", …)`, when `node` is such a call. */
const routePathOf = (node: TS.Node) => {
	if (!ts.isCallExpression(node)) return null;
	const callee = node.expression;
	if (
		!ts.isPropertyAccessExpression(callee) ||
		!ts.isIdentifier(callee.name) ||
		!ELYSIA_ROUTE_METHODS.has(callee.name.text)
	)
		return null;
	const [firstArg] = node.arguments;

	return firstArg &&
		ts.isStringLiteral(firstArg) &&
		firstArg.text.startsWith('/')
		? firstArg.text
		: null;
};

/** Find the enclosing `.method("/path", ...)` Elysia call (if any) by
 *  walking up the AST from `node`. The path argument is returned. */
const findEnclosingMountPath = (node: TS.Node) => {
	let cursor: TS.Node | undefined = node.parent;
	while (cursor) {
		const path = routePathOf(cursor);
		if (path !== null) return path;
		cursor = cursor.parent;
	}

	return null;
};

const propertyNameOf = (property: TS.PropertyAssignment) =>
	ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
		? property.name.text
		: null;

/* The manifest key after one more property of the options object, given
 * the key so far. The properties are taken in the order written:
 *
 *   `pagePath: asset(manifest, "Foo")` sets it, and a `pagePath` that is
 *   not shaped that way clears whatever came before;
 *
 *   `...helper("Foo")` supplies it only when nothing has yet. That is the
 *   project-level convention for passing page-bundle paths (a
 *   `pageAssets(key)` helper returning `{ indexPath, pagePath }`): the
 *   helper's body cannot be traced in general, but its string argument
 *   IS the manifest key by convention. */
const nextManifestKey = (
	current: string | null,
	property: TS.ObjectLiteralElementLike
) => {
	if (ts.isPropertyAssignment(property))
		return propertyNameOf(property) === 'pagePath'
			? extractManifestKey(property.initializer)
			: current;
	if (!ts.isSpreadAssignment(property) || current) return current;
	const spread = property.expression;
	if (!ts.isCallExpression(spread)) return current;
	const [firstArg] = spread.arguments;

	return firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : current;
};

/* The call `node` makes, when it is `handleAngularPageRequest({ … })`
 * with a manifest key that can be read. */
const handlerCallAt = (node: TS.Node, filePath: string) => {
	if (
		!ts.isCallExpression(node) ||
		!ts.isIdentifier(node.expression) ||
		node.expression.text !== 'handleAngularPageRequest'
	)
		return null;
	const [argument] = node.arguments;
	if (!argument || !ts.isObjectLiteralExpression(argument)) return null;
	const manifestKey = argument.properties.reduce<string | null>(
		nextManifestKey,
		null
	);
	if (!manifestKey) return null;
	const call: AngularHandlerCall = {
		manifestKey,
		mountPath: findEnclosingMountPath(node),
		sourceFile: filePath
	};

	return call;
};

const readSource = (filePath: string) => {
	try {
		return readFileSync(filePath, 'utf-8');
	} catch {
		return undefined;
	}
};

const extractCallsFromFile = (filePath: string) => {
	const source = readSource(filePath);
	if (source === undefined || !fileMayContainAngularHandler(source))
		return [];

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);
	const calls: AngularHandlerCall[] = [];
	const visit = (node: TS.Node) => {
		const call = handlerCallAt(node, filePath);
		if (call) calls.push(call);
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);

	return calls;
};

/** Walk every TypeScript file under `projectRoot` and return all
 *  `handleAngularPageRequest({...})` calls found. */
export const scanAngularHandlerCalls = (projectRoot: string) =>
	collectSourceFiles(projectRoot).flatMap((file) =>
		extractCallsFromFile(file)
	);
