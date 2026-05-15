/* Build-time static analysis: find every `handleAngularPageRequest({...})`
 * call in the project's TypeScript sources and pull out the metadata the
 * Angular build pipeline needs:
 *
 *   - the manifest key from `pagePath: asset(manifest, "Home")` (used to
 *     match the call back to a page bundle),
 *   - the verbatim source of the `providers:` argument expression (used
 *     to emit a generated provider module the client bundle imports), and
 *   - the parent Elysia route mount path from the surrounding `.get/.post/...`
 *     call (used to auto-set `APP_BASE_HREF` for sub-router pages like
 *     `/portal/*` and `/admin/*`).
 *
 * Falls back to a scan of every project `.ts` file rather than tracing
 * `.use(plugin)` from a single entry — same approach `scanRouteRegistrations`
 * takes, and it works because the heuristic (`.method("/path", ...)` with
 * a `handleAngularPageRequest(...)` inside) is extremely specific.
 *
 * Imports referenced by the providers expression are also collected so the
 * generated file the build emits can re-import them from the same modules.
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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

export type ImportSpec = {
	/** Local name as used inside the providers expression. */
	localName: string;
	/** Original exported name (matches localName unless the source used `as`). */
	importedName: string;
	/** `true` when the import was a default import (`import foo from "..."`). */
	isDefault: boolean;
	/** Module specifier as written in the source — could be a bare package
	 *  name (`@angular/router`) or a path (`./foo`, `../../utils/x`). The
	 *  path forms are resolved to absolute file paths by `resolvedAbsPath`. */
	source: string;
	/** Absolute path the source resolves to, or `null` for bare specifiers
	 *  (`@angular/router`, `firebase/auth`, …) which the generated file
	 *  will re-import by the same bare specifier. */
	resolvedAbsPath: string | null;
};

export type AngularHandlerCall = {
	/** File the call lives in. */
	sourceFile: string;
	/** Manifest key extracted from `pagePath: asset(manifest, "Foo")`. */
	manifestKey: string;
	/** Verbatim source text of the `providers:` argument expression, or
	 *  `null` if the call didn't include one. */
	providersExpr: string | null;
	/** Imports from the source file that the `providers:` expression refers
	 *  to. Empty array when `providersExpr` is null. */
	providerImports: ImportSpec[];
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

/** Walk `import` declarations and build a map of local-name → ImportSpec.
 *  The map is what `collectProviderImports` filters against once it knows
 *  which identifiers the providers expression actually uses. */
const collectFileImports = (
	sf: ts.SourceFile,
	filePath: string
): Map<string, ImportSpec> => {
	const map = new Map<string, ImportSpec>();
	const fileDir = dirname(filePath);

	const recordSpec = (localName: string, spec: ImportSpec) => {
		map.set(localName, spec);
	};

	const resolveSource = (specifier: string): string | null => {
		if (specifier.startsWith('.')) {
			return resolve(fileDir, specifier);
		}
		if (isAbsolute(specifier)) {
			return specifier;
		}

		return null;
	};

	for (const statement of sf.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		// Skip type-only imports (`import type {...}`) — they don't carry
		// runtime values, so they can't be part of a providers expression.
		if (statement.importClause?.isTypeOnly) continue;
		const source = statement.moduleSpecifier.text;
		const resolvedAbsPath = resolveSource(source);

		const clause = statement.importClause;
		if (!clause) continue;

		// `import Foo from "./bar"` — default import.
		if (clause.name) {
			recordSpec(clause.name.text, {
				importedName: 'default',
				isDefault: true,
				localName: clause.name.text,
				resolvedAbsPath,
				source
			});
		}

		const bindings = clause.namedBindings;
		if (!bindings) continue;

		// `import * as Ns from "./bar"` — namespace import. The
		// providers expression might reference `Ns.foo`, which means
		// the generated file needs the whole namespace.
		if (ts.isNamespaceImport(bindings)) {
			recordSpec(bindings.name.text, {
				importedName: '*',
				isDefault: false,
				localName: bindings.name.text,
				resolvedAbsPath,
				source
			});
			continue;
		}

		// `import { foo, bar as baz } from "./bar"` — named imports.
		for (const element of bindings.elements) {
			// Skip type-only named imports (`import { type Foo } from ...`).
			if (element.isTypeOnly) continue;
			const localName = element.name.text;
			const importedName = element.propertyName?.text ?? localName;
			recordSpec(localName, {
				importedName,
				isDefault: false,
				localName,
				resolvedAbsPath,
				source
			});
		}
	}

	return map;
};

/** Collect every identifier the providers expression references. Property
 *  accesses contribute their root (e.g. `Foo.bar` → `Foo`); call expression
 *  arguments contribute as expected; nested expressions are walked through. */
const collectExpressionIdentifiers = (
	expr: ts.Expression
): Set<string> => {
	const out = new Set<string>();

	const visit = (node: ts.Node) => {
		if (ts.isIdentifier(node)) {
			out.add(node.text);

			return;
		}

		// For property access `Foo.bar`, only the root (`Foo`) is
		// possibly an imported binding; the property name is a member.
		if (ts.isPropertyAccessExpression(node)) {
			visit(node.expression);

			return;
		}

		ts.forEachChild(node, visit);
	};

	visit(expr);

	return out;
};

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

	const imports = collectFileImports(sf, filePath);

	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'handleAngularPageRequest'
		) {
			const [arg] = node.arguments;
			if (arg && ts.isObjectLiteralExpression(arg)) {
				let manifestKey: string | null = null;
				let providersExpr: ts.Expression | null = null;
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
						} else if (name === 'providers') {
							providersExpr = prop.initializer;
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
					const providerImports: ImportSpec[] = [];
					let providersExprText: string | null = null;
					if (providersExpr) {
						providersExprText = providersExpr.getText(sf);
						const idents = collectExpressionIdentifiers(providersExpr);
						for (const ident of idents) {
							const spec = imports.get(ident);
							if (spec) providerImports.push(spec);
						}
					}
					out.push({
						manifestKey,
						mountPath: findEnclosingMountPath(node),
						providerImports,
						providersExpr: providersExprText,
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
