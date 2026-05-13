/* Build-time static analysis pass that walks project TypeScript source
 * looking for Elysia route registrations (`.get("/path", ...)`,
 * `.post("/path", ...)`, etc.) and returns a route table the sitemap
 * generator can consume.
 *
 * Replaces the runtime `onStart` sitemap hook in `prepare.ts`. The
 * runtime path was racy under `absolute compile` — the prerender child
 * server was killed before the async `onStart` write to disk could
 * complete, leaving `sitemap.xml` missing from the build output. This
 * pass makes the sitemap a deterministic build artifact: same input,
 * same output, no server lifecycle involved.
 *
 * Heuristic: any CallExpression whose callee is a PropertyAccessExpression
 * with a property name in {all, delete, get, head, options, patch, post,
 * put} and whose first argument is a string literal starting with "/"
 * is treated as a route registration. False positives are unlikely in
 * practice — the combination is specific to Elysia-style chains.
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

export type ExtractedRoute = {
	/** Uppercase HTTP method, matching Elysia's runtime `route.method`. */
	method: string;
	/** Path argument literal — including leading slash, no host. */
	path: string;
	/** Verbatim source of the full `.method(...)` CallExpression. Used
	 *  downstream as a stand-in for the runtime handler so the existing
	 *  `isPageHandler` / `extractSitemapMetadata` substring checks work
	 *  unchanged against AST-discovered routes. */
	handlerSource: string;
};

const getScriptKind = (filePath: string) => {
	if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (filePath.endsWith('.mts')) return ts.ScriptKind.TS;
	if (filePath.endsWith('.cts')) return ts.ScriptKind.TS;

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

const fileMayContainRouteRegistrations = (source: string) => {
	// Cheap pre-filter — skip the AST parse if no method-name token even
	// appears in the file. Real route files always contain `.get(` or
	// similar somewhere in the bytes.
	for (const method of ELYSIA_ROUTE_METHODS) {
		if (source.includes(`.${method}(`)) return true;
	}

	return false;
};

const extractRoutesFromFile = (
	filePath: string,
	out: ExtractedRoute[]
): void => {
	let source: string;
	try {
		source = readFileSync(filePath, 'utf-8');
	} catch {
		return;
	}

	if (!fileMayContainRouteRegistrations(source)) return;

	const sf = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node)) {
			const callee = node.expression;
			if (
				ts.isPropertyAccessExpression(callee) &&
				ts.isIdentifier(callee.name)
			) {
				const methodName = callee.name.text;
				if (ELYSIA_ROUTE_METHODS.has(methodName)) {
					const firstArg = node.arguments[0];
					if (
						firstArg &&
						ts.isStringLiteral(firstArg) &&
						firstArg.text.startsWith('/')
					) {
						// Take only the handler / options args (everything
						// after the path). Using node.getText() here would
						// include the preceding chain (e.g. `.get("/", x)
						// .get("/signin", y)` would capture the whole
						// chain when visiting the outer call), causing the
						// metadata regex to bleed sitemap: {…} blocks
						// across routes.
						const argTexts: string[] = [];
						for (let i = 1; i < node.arguments.length; i++) {
							const arg = node.arguments[i];
							if (arg) argTexts.push(arg.getText(sf));
						}
						out.push({
							handlerSource: argTexts.join('\n'),
							method: methodName.toUpperCase(),
							path: firstArg.text
						});
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sf, visit);
};

/** Walk every TypeScript source file under `projectRoot` and return the
 *  Elysia route registrations found. Skip-dirs (`node_modules`, `dist`,
 *  `build`, framework build caches, dotfile dirs) are excluded.
 *
 *  No path deduplication here on purpose: the same path (e.g. `/`) is
 *  frequently registered by multiple plugins (one page route at the
 *  root, several API sub-plugins under prefixes like `/v1/foo`). The
 *  scanner has no way to know the prefix without tracing `.use()` /
 *  `new Elysia({ prefix })`, but it doesn't need to — sitemap discovery
 *  downstream filters by `isPageHandler` and then dedups by mount path,
 *  so API duplicates are dropped naturally. */
export const scanRouteRegistrations = (
	projectRoot: string
): ExtractedRoute[] => {
	const files = collectSourceFiles(projectRoot);
	const collected: ExtractedRoute[] = [];

	for (const file of files) {
		extractRoutesFromFile(file, collected);
	}

	return collected;
};
