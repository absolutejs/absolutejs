/* Build-time static analysis pass that walks project source looking
 * for `handleVuePageRequest({...})` calls flagged `client: 'none'`,
 * and returns the set of Vue page basenames the build should treat as
 * SSR-only.
 *
 * SSR-only pages keep their server bundle (used by the request handler)
 * and per-page scoped CSS, but skip the client hydration index and the
 * page client bundle entirely — no `<script type="module">` ships, no
 * manifest entry is emitted, and the bundler never sees them.
 *
 * Heuristic: a CallExpression named `handleVuePageRequest` (either bare
 * or via property access) whose first argument is an ObjectLiteralExpression
 * containing both:
 *   - `client: 'none'` (string literal)
 *   - `pagePath: asset(manifest, '<Name>')` (literal manifest key)
 *
 * The literal manifest key is the PascalCased basename of the .vue
 * source — the same key `compileVue` uses when generating the manifest —
 * so the build can resolve `<Name>` back to a concrete .vue entry path
 * without re-reading the manifest at scan time.
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

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

const getScriptKind = (filePath: string) => {
	if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;

	return ts.ScriptKind.TS;
};

const hasSourceExtension = (filePath: string) => {
	const idx = filePath.lastIndexOf('.');
	if (idx === -1) return false;

	return SOURCE_EXTENSIONS.has(filePath.slice(idx));
};

const collectSourceFiles = (root: string) => {
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

const fileMayContainVueHandler = (source: string) =>
	source.includes('handleVuePageRequest');

const isHandleVuePageRequestCallee = (expression: ts.Expression) => {
	if (ts.isIdentifier(expression)) {
		return expression.text === 'handleVuePageRequest';
	}
	if (
		ts.isPropertyAccessExpression(expression) &&
		ts.isIdentifier(expression.name)
	) {
		return expression.name.text === 'handleVuePageRequest';
	}

	return false;
};

const getPropertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
		return name.text;
	}

	return null;
};

const readStringLiteralValue = (node: ts.Expression) => {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text;
	}

	return null;
};

const isAssetCall = (node: ts.Expression) => {
	if (!ts.isCallExpression(node)) return false;
	if (!ts.isIdentifier(node.expression)) return false;

	return node.expression.text === 'asset';
};

/* `asset(manifest, '<Name>')` is the convention — the second argument
 *  is the literal manifest key. We deliberately accept any first arg
 *  (typically `manifest`, but a user could rename it) and only read
 *  the literal second arg. Non-literal second args make the page
 *  un-resolvable at build time; fall back to keeping the client bundle. */
const extractAssetLiteralKey = (call: ts.CallExpression) => {
	if (call.arguments.length < 2) return null;
	const keyArg = call.arguments[1];
	if (!keyArg) return null;

	return readStringLiteralValue(keyArg);
};

const extractPagePathAssetKey = (initializer: ts.Expression) => {
	if (!isAssetCall(initializer)) return null;
	if (!ts.isCallExpression(initializer)) return null;

	return extractAssetLiteralKey(initializer);
};

const extractSsrOnlyPageName = (
	objectLiteral: ts.ObjectLiteralExpression
): string | null => {
	let hasClientNone = false;
	let pageAssetKey: string | null = null;

	for (const property of objectLiteral.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = getPropertyName(property.name);
		if (!name) continue;

		if (name === 'client') {
			const value = readStringLiteralValue(property.initializer);
			if (value === 'none') hasClientNone = true;
			continue;
		}

		if (name === 'pagePath') {
			pageAssetKey = extractPagePathAssetKey(property.initializer);
		}
	}

	if (!hasClientNone) return null;

	return pageAssetKey;
};

const extractFromFile = (filePath: string, out: Set<string>) => {
	let source: string;
	try {
		source = readFileSync(filePath, 'utf-8');
	} catch {
		return;
	}

	if (!fileMayContainVueHandler(source)) return;

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);

	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			isHandleVuePageRequestCallee(node.expression)
		) {
			const firstArg = node.arguments[0];
			if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
				const pageName = extractSsrOnlyPageName(firstArg);
				if (pageName) out.add(pageName);
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);
};

/** Walk every TypeScript source file under `projectRoot` and collect
 *  the set of Vue page manifest keys flagged `client: 'none'` at
 *  registration time. The returned names correspond to the PascalCased
 *  basenames of the .vue source files (e.g. `LandingPage` matches
 *  `LandingPage.vue`). */
export const scanVueSsrOnlyPages = (projectRoot: string) => {
	const files = collectSourceFiles(projectRoot);
	const ssrOnlyPageNames = new Set<string>();

	for (const file of files) {
		extractFromFile(file, ssrOnlyPageNames);
	}

	return ssrOnlyPageNames;
};
