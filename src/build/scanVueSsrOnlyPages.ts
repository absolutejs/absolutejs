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
 *   - `client: 'none'`
 *   - `pagePath: asset(manifest, '<Name>')`
 * Each value may be a string literal or a `const` declared in the same file
 * (`const CLIENT = 'none'`, `as const` and `satisfies` included, and the
 * shorthand `{ client }`). Anything else (an import, a function call, a
 * `let`) can't be known at build time; that page keeps its client bundle,
 * which still works, it just isn't trimmed.
 *
 * The literal manifest key is the PascalCased basename of the .vue
 * source — the same key `compileVue` uses when generating the manifest —
 * so the build can resolve `<Name>` back to a concrete .vue entry path
 * without re-reading the manifest at scan time.
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { createStampedFileCache } from './stampedFileCache';

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

/** Same-file `const NAME = '<string>'` bindings. A name declared more than
 *  once with different values (shadowing) maps to null: unknown. */
type ConstStrings = Map<string, string | null>;

const unwrapExpression = (node: ts.Expression): ts.Expression => {
	if (
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isParenthesizedExpression(node) ||
		ts.isTypeAssertionExpression(node)
	) {
		return unwrapExpression(node.expression);
	}

	return node;
};

const readLiteral = (node: ts.Expression) => {
	const inner = unwrapExpression(node);
	if (
		ts.isStringLiteral(inner) ||
		ts.isNoSubstitutionTemplateLiteral(inner)
	) {
		return inner.text;
	}

	return null;
};

const isConstDeclaration = (declaration: ts.VariableDeclaration) =>
	ts.isVariableDeclarationList(declaration.parent) &&
	(declaration.parent.flags & ts.NodeFlags.Const) !== 0;

const collectConstStrings = (sourceFile: ts.SourceFile) => {
	const constants: ConstStrings = new Map();
	const visit = (node: ts.Node) => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			isConstDeclaration(node)
		) {
			const name = node.name.text;
			const value = readLiteral(node.initializer);
			const known = constants.has(name);
			constants.set(
				name,
				known && constants.get(name) !== value ? null : value
			);
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);

	return constants;
};

const readStringValue = (node: ts.Expression, constants: ConstStrings) => {
	const inner = unwrapExpression(node);
	if (ts.isIdentifier(inner)) return constants.get(inner.text) ?? null;

	return readLiteral(inner);
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
const extractAssetLiteralKey = (
	call: ts.CallExpression,
	constants: ConstStrings
) => {
	if (call.arguments.length < 2) return null;
	const keyArg = call.arguments[1];
	if (!keyArg) return null;

	return readStringValue(keyArg, constants);
};

const extractPagePathAssetKey = (
	initializer: ts.Expression,
	constants: ConstStrings
) => {
	if (!isAssetCall(initializer)) return null;
	if (!ts.isCallExpression(initializer)) return null;

	return extractAssetLiteralKey(initializer, constants);
};

/** The property's name and value expression; `{ client }` reads the
 *  same-file binding named `client`. */
const readProperty = (property: ts.ObjectLiteralElementLike) => {
	if (ts.isShorthandPropertyAssignment(property)) {
		return { name: property.name.text, value: property.name };
	}
	if (!ts.isPropertyAssignment(property)) return null;
	const name = getPropertyName(property.name);

	return name ? { name, value: property.initializer } : null;
};

const extractSsrOnlyPageName = (
	objectLiteral: ts.ObjectLiteralExpression,
	constants: ConstStrings
): string | null => {
	let hasClientNone = false;
	let pageAssetKey: string | null = null;

	for (const element of objectLiteral.properties) {
		const property = readProperty(element);
		if (!property) continue;

		if (property.name === 'client') {
			hasClientNone =
				readStringValue(property.value, constants) === 'none';
			continue;
		}

		if (property.name === 'pagePath') {
			pageAssetKey = extractPagePathAssetKey(property.value, constants);
		}
	}

	if (!hasClientNone) return null;

	return pageAssetKey;
};

const extractFromFile = (filePath: string) => {
	const out = new Set<string>();
	let source: string;
	try {
		source = readFileSync(filePath, 'utf-8');
	} catch {
		return [];
	}

	if (!fileMayContainVueHandler(source)) return [];

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath)
	);

	const constants = collectConstStrings(sourceFile);
	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			isHandleVuePageRequestCallee(node.expression)
		) {
			const firstArg = node.arguments[0];
			if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
				const pageName = extractSsrOnlyPageName(firstArg, constants);
				if (pageName) out.add(pageName);
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	return [...out];
};

/* Dev builds pages on demand, so this whole-project walk reruns on every
 * page open against an unchanged tree. The walk stays (it is a few
 * milliseconds and it is what makes the memo sound); only the per-file
 * read + `ts.createSourceFile` is reused while a file's `(mtimeMs, size)`
 * stamp holds. Each cached value is purely content-derived, so the union
 * below is identical to an uncached scan. See `stampedFileCache.ts`. */
const ssrOnlyNameCache = createStampedFileCache<string[]>();

/** Walk every TypeScript source file under `projectRoot` and collect
 *  the set of Vue page manifest keys flagged `client: 'none'` at
 *  registration time. The returned names correspond to the PascalCased
 *  basenames of the .vue source files (e.g. `LandingPage` matches
 *  `LandingPage.vue`).
 *
 *  `memoise` is set for dev builds only; a production build scans once and
 *  opts out so it pays no stat pass. */
export const scanVueSsrOnlyPages = (projectRoot: string, memoise = false) => {
	const files = collectSourceFiles(projectRoot);
	const ssrOnlyPageNames = new Set<string>();

	for (const file of files) {
		const names = memoise
			? ssrOnlyNameCache.read(file, () => extractFromFile(file))
			: extractFromFile(file);
		for (const name of names) ssrOnlyPageNames.add(name);
	}
	if (memoise) ssrOnlyNameCache.endPass();

	return ssrOnlyPageNames;
};
