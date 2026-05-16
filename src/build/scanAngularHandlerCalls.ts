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
import ts from 'typescript';

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

export type AngularHandlerCall = {
	/** File the call lives in. */
	sourceFile: string;
	/** Manifest key extracted from `pagePath: asset(manifest, "Foo")`. */
	manifestKey: string;
	/** Mount path from the surrounding `.get("/path", ...)` / `.post(...)`
	 *  Elysia chain. `null` when the call isn't directly inside such a
	 *  registration (rare but possible — e.g. inside a helper function). */
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

const collectSourceFiles = (root: string): string[] => {
	const out: string[] = [];
	const stack: string[] = [root];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;

		let entries: Dirent[];
		try {
			entries = readdirSync(dir, {
				encoding: 'utf-8',
				withFileTypes: true
			});
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				if (entry.name.startsWith('.')) continue;
				stack.push(join(dir, entry.name));
			} else if (entry.isFile() && hasSourceExtension(entry.name)) {
				out.push(join(dir, entry.name));
			}
		}
	}

	return out;
};

const fileMayContainAngularHandler = (source: string) =>
	source.includes('handleAngularPageRequest');

/** Look for the manifest key string in something like
 *  `pagePath: asset(manifest, "Foo")`. Returns null if the value isn't
 *  shaped that way (e.g. dynamic computation). */
const extractManifestKey = (
	pagePathValue: ts.Expression
): string | null => {
	if (!ts.isCallExpression(pagePathValue)) return null;
	const callee = pagePathValue.expression;
	if (!ts.isIdentifier(callee) || callee.text !== 'asset') return null;
	const [, second] = pagePathValue.arguments;
	if (!second) return null;
	if (!ts.isStringLiteral(second)) return null;

	return second.text;
};

/** Find the enclosing `.method("/path", ...)` Elysia call (if any) by
 *  walking up the AST from `node`. The path argument is returned. */
const findEnclosingMountPath = (node: ts.Node): string | null => {
	let cursor: ts.Node | undefined = node.parent;
	while (cursor) {
		if (ts.isCallExpression(cursor)) {
			const callee = cursor.expression;
			if (
				ts.isPropertyAccessExpression(callee) &&
				ts.isIdentifier(callee.name) &&
				ELYSIA_ROUTE_METHODS.has(callee.name.text)
			) {
				const firstArg = cursor.arguments[0];
				if (
					firstArg &&
					ts.isStringLiteral(firstArg) &&
					firstArg.text.startsWith('/')
				) {
					return firstArg.text;
				}
			}
		}
		cursor = cursor.parent;
	}

	return null;
};

const extractCallsFromFile = (
	filePath: string,
	out: AngularHandlerCall[]
): void => {
	let source: string;
	try {
		source = readFileSync(filePath, 'utf-8');
	} catch {
		return;
	}

	if (!fileMayContainAngularHandler(source)) return;

	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);

	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'handleAngularPageRequest'
		) {
			const [arg] = node.arguments;
			if (arg && ts.isObjectLiteralExpression(arg)) {
				let manifestKey: string | null = null;
				for (const prop of arg.properties) {
					if (ts.isPropertyAssignment(prop)) {
						if (!prop.name) continue;
						const name = ts.isIdentifier(prop.name)
							? prop.name.text
							: ts.isStringLiteral(prop.name)
								? prop.name.text
								: null;
						if (name === 'pagePath') {
							manifestKey = extractManifestKey(prop.initializer);
						}
					} else if (ts.isSpreadAssignment(prop)) {
						// Project-level convention: `...helper("Foo")` is the
						// idiomatic way to pass page-bundle paths (e.g. the
						// `pageAssets(key)` helper that returns
						// `{ indexPath, pagePath: asset(manifest, key) }`).
						// We can't trace the helper body in the general case,
						// but the string literal arg IS the manifest key by
						// convention, so use it as a fallback when no direct
						// `pagePath` property was found.
						if (manifestKey) continue;
						const spreadExpr = prop.expression;
						if (
							ts.isCallExpression(spreadExpr) &&
							spreadExpr.arguments.length > 0
						) {
							const [firstArg] = spreadExpr.arguments;
							if (firstArg && ts.isStringLiteral(firstArg)) {
								manifestKey = firstArg.text;
							}
						}
					}
				}

				if (manifestKey) {
					out.push({
						manifestKey,
						mountPath: findEnclosingMountPath(node),
						sourceFile: filePath
					});
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sf, visit);
};

/** Walk every TypeScript file under `projectRoot` and return all
 *  `handleAngularPageRequest({...})` calls found. */
export const scanAngularHandlerCalls = (
	projectRoot: string
): AngularHandlerCall[] => {
	const files = collectSourceFiles(projectRoot);
	const collected: AngularHandlerCall[] = [];

	for (const file of files) {
		extractCallsFromFile(file, collected);
	}

	return collected;
};
