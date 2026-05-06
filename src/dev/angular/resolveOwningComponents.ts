/* Resolve a changed file → list of `(filePath, className, kind)`
 * tuples that should receive a fresh surgical update.
 *
 * Cases:
 *   1. The changed file is a `*.component.ts` / `*.directive.ts` /
 *      `*.pipe.ts` / `*.service.ts` (or any `.ts` file whose top-level
 *      classes carry the matching Angular decorators) — parse it and
 *      return every decorated class.
 *   2. The changed file is a `*.component.html` / `*.component.css`
 *      / `*.scss` / `*.sass` — look up an inverted index built lazily
 *      on first non-`.ts` edit. The index maps every resolved
 *      `templateUrl` / `styleUrl` / `styleUrls` path to its owning
 *      component class. Hits are O(1).
 *
 * Cache invalidation: a `.ts` edit clears the index because changing
 * a component's `templateUrl` mapping is structural (the index would
 * point at the wrong class otherwise). The next non-`.ts` edit
 * rebuilds. The full rebuild costs ~300ms on a medium app, but it
 * happens at most once per `.ts` save, not once per `.html` save. */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';

export type AngularEntityKind = 'component' | 'directive' | 'pipe' | 'service';

export type AffectedEntity = {
	componentFilePath: string;
	className: string;
	kind: AngularEntityKind;
};

/* Backward-compat alias — older callers used `OwningComponent` and
 * accessed `.componentFilePath` + `.className`. New shape is a
 * superset. */
export type OwningComponent = AffectedEntity;

const ENTITY_DECORATORS: Record<string, AngularEntityKind> = {
	Component: 'component',
	Directive: 'directive',
	Pipe: 'pipe',
	Injectable: 'service'
};

const isAngularSourceFile = (file: string): boolean =>
	file.endsWith('.ts') || file.endsWith('.tsx');

const walkAngularSourceFiles = (root: string): string[] => {
	const out: string[] = [];
	const visit = (dir: string) => {
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(full);
			} else if (entry.isFile() && isAngularSourceFile(entry.name)) {
				out.push(full);
			}
		}
	};
	visit(root);

	return out;
};

type DecoratedClass = {
	className: string;
	kind: AngularEntityKind;
	templateUrls: string[];
	styleUrls: string[];
	/* Name of the parent class in the heritage clause, if any.
	 * Used to detect non-decorated parent classes whose edits
	 * should propagate to Angular descendants. Decorated parents
	 * are handled separately by `fastHmrCompiler`'s
	 * `inheritsDecoratedClass` bail. */
	extendsName: string | null;
};

const getStringPropertyValue = (
	obj: ts.ObjectLiteralExpression,
	name: string
): string | null => {
	for (const prop of obj.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const propName = ts.isIdentifier(prop.name)
			? prop.name.text
			: ts.isStringLiteral(prop.name)
				? prop.name.text
				: null;
		if (propName !== name) continue;
		const init = prop.initializer;
		if (
			ts.isStringLiteral(init) ||
			ts.isNoSubstitutionTemplateLiteral(init)
		) {
			return init.text;
		}
	}

	return null;
};

const getStringArrayProperty = (
	obj: ts.ObjectLiteralExpression,
	name: string
): string[] => {
	const out: string[] = [];
	for (const prop of obj.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const propName = ts.isIdentifier(prop.name)
			? prop.name.text
			: ts.isStringLiteral(prop.name)
				? prop.name.text
				: null;
		if (propName !== name) continue;
		const init = prop.initializer;
		if (!ts.isArrayLiteralExpression(init)) continue;
		for (const element of init.elements) {
			if (
				ts.isStringLiteral(element) ||
				ts.isNoSubstitutionTemplateLiteral(element)
			) {
				out.push(element.text);
			}
		}
	}

	return out;
};

/* Walk a single source file, return every class with one of the
 * tracked Angular decorators. A class can technically have more than
 * one Angular decorator (rare), but the decorator type-checker
 * rejects that — picking the first matching one is correct. */
const parseDecoratedClasses = (filePath: string): DecoratedClass[] => {
	let source: string;
	try {
		source = readFileSync(filePath, 'utf8');
	} catch {
		return [];
	}

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS
	);

	const out: DecoratedClass[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isClassDeclaration(node) && node.name) {
			for (const decorator of ts.getDecorators(node) ?? []) {
				const expr = decorator.expression;
				if (!ts.isCallExpression(expr)) continue;
				const fn = expr.expression;
				if (!ts.isIdentifier(fn)) continue;
				const kind = ENTITY_DECORATORS[fn.text];
				if (!kind) continue;

				/* Capture the heritage clause's first-extends
				 * identifier name, if any. Resolved to a parent
				 * file path during resource-index build. */
				let extendsName: string | null = null;
				for (const heritage of node.heritageClauses ?? []) {
					if (heritage.token !== ts.SyntaxKind.ExtendsKeyword) {
						continue;
					}
					const first = heritage.types[0];
					if (first && ts.isIdentifier(first.expression)) {
						extendsName = first.expression.text;
					}
					break;
				}

				const entry: DecoratedClass = {
					className: node.name.text,
					kind,
					styleUrls: [],
					templateUrls: [],
					extendsName
				};
				const arg = expr.arguments[0];
				if (
					arg &&
					ts.isObjectLiteralExpression(arg) &&
					kind === 'component'
				) {
					const tplUrl = getStringPropertyValue(arg, 'templateUrl');
					if (tplUrl) entry.templateUrls.push(tplUrl);
					const styleUrl = getStringPropertyValue(arg, 'styleUrl');
					if (styleUrl) entry.styleUrls.push(styleUrl);
					entry.styleUrls.push(
						...getStringArrayProperty(arg, 'styleUrls')
					);
				}
				out.push(entry);
				break;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return out;
};

const safeNormalize = (path: string): string =>
	resolve(path).replace(/\\/g, '/');

export const resolveOwningComponents = (params: {
	changedFilePath: string;
	userAngularRoot: string;
}): AffectedEntity[] => {
	const { changedFilePath, userAngularRoot } = params;
	const changedAbs = safeNormalize(changedFilePath);
	const out: AffectedEntity[] = [];

	const ext = extname(changedAbs).toLowerCase();

	// Direct edit to a TS file: every decorated class in that file
	// gets a surgical update. Decorator kind drives which surgical
	// path runs (`tryFastHmr` branches on it).
	if (ext === '.ts' || ext === '.tsx') {
		const classes = parseDecoratedClasses(changedAbs);
		for (const cls of classes) {
			out.push({
				className: cls.className,
				componentFilePath: changedAbs,
				kind: cls.kind
			});
		}

		return out;
	}

	// Resource edit: only components have templateUrl / styleUrl.
	if (
		ext !== '.html' &&
		ext !== '.css' &&
		ext !== '.scss' &&
		ext !== '.sass'
	) {
		return out;
	}

	let rootStat: ReturnType<typeof statSync>;
	try {
		rootStat = statSync(userAngularRoot);
	} catch {
		return out;
	}
	if (!rootStat.isDirectory()) return out;

	const index = getOrBuildResourceIndex(userAngularRoot);
	const owners = index.get(changedAbs);
	if (owners) {
		out.push(...owners);
	}

	return out;
};

/* ───── Resource → owners inverted index ─────────────────────────
 *
 * One Map<absoluteResourcePath, AffectedEntity[]> per Angular root,
 * built on demand. Persists for the lifetime of the dev server until
 * `invalidateResourceIndex()` is called (on any `.ts` edit — the
 * mapping might have changed). Subsequent non-`.ts` edits do an O(1)
 * Map lookup instead of re-walking the entire user source tree. */
type ResourceIndex = Map<string, AffectedEntity[]>;

/* ───── Parent-file → descendant Angular entity index ────────────
 *
 * Tracks classes referenced in `extends` heritage clauses of every
 * Angular-decorated class. Maps each parent file's absolute path
 * to the list of descendant Angular entities that extend a class
 * declared in that file.
 *
 * Use case: edits to a non-Angular-decorated parent class file
 * (e.g., a utility base class with shared method bodies) need to
 * trigger a Tier 1b rebootstrap so descendant Angular components
 * pick up the new parent prototype. Without this index, those
 * edits would not enter the Angular HMR pipeline at all and the
 * descendants' inherited methods would stay frozen until reload.
 *
 * Decorated parents are NOT routed through this index. They reach
 * Angular HMR via their own decorator-driven path; the descendant
 * inherits the patched prototype through the JS chain. */
type ParentFileIndex = Map<string, AffectedEntity[]>;

type IndexBundle = {
	resource: ResourceIndex;
	parentFile: ParentFileIndex;
};

const indexByRoot = new Map<string, IndexBundle>();

/* Resolve a class identifier referenced in a heritage clause to
 * the absolute path of the file that declares it, by walking the
 * source file's project-local imports. Bare-specifier (npm
 * package) parents and unresolved imports return null; only
 * project-local files are tracked, since edits to npm packages
 * don't fire the watcher. */
const resolveParentClassFile = (
	parentName: string,
	childFilePath: string,
	angularRoot: string
): string | null => {
	let source: string;
	try {
		source = readFileSync(childFilePath, 'utf8');
	} catch {
		return null;
	}
	const sf = ts.createSourceFile(
		childFilePath,
		source,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS
	);
	const childDir = dirname(childFilePath);
	for (const stmt of sf.statements) {
		if (!ts.isImportDeclaration(stmt)) continue;
		if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
		const clause = stmt.importClause;
		if (!clause || clause.isTypeOnly) continue;
		let matchesName = false;
		if (clause.name && clause.name.text === parentName) matchesName = true;
		if (
			!matchesName &&
			clause.namedBindings &&
			ts.isNamedImports(clause.namedBindings)
		) {
			for (const el of clause.namedBindings.elements) {
				if (el.isTypeOnly) continue;
				if (el.name.text === parentName) {
					matchesName = true;
					break;
				}
			}
		}
		if (!matchesName) continue;
		const spec = stmt.moduleSpecifier.text;
		if (!spec.startsWith('.') && !spec.startsWith('/')) {
			// Bare specifier (npm package). The watcher never fires
			// for files inside `node_modules`; leave unresolved.
			return null;
		}
		const base = resolve(childDir, spec);
		const candidates = [
			`${base}.ts`,
			`${base}.tsx`,
			`${base}/index.ts`,
			`${base}/index.tsx`
		];
		const angularRootNorm = safeNormalize(angularRoot);
		for (const candidate of candidates) {
			try {
				if (statSync(candidate).isFile()) {
					const norm = safeNormalize(candidate);
					/* Only track project-local parents inside the
					 * configured Angular root. Files outside the
					 * root don't fire the watcher's Angular
					 * framework path so the parent-file index
					 * wouldn't be consulted for them anyway. */
					if (!norm.startsWith(angularRootNorm)) return null;
					return norm;
				}
			} catch {
				/* candidate doesn't exist, try next */
			}
		}
		return null;
	}
	return null;
};

const getOrBuildIndexes = (userAngularRoot: string): IndexBundle => {
	const cached = indexByRoot.get(userAngularRoot);
	if (cached) return cached;

	const resource: ResourceIndex = new Map();
	const parentFile: ParentFileIndex = new Map();

	for (const tsPath of walkAngularSourceFiles(userAngularRoot)) {
		const classes = parseDecoratedClasses(tsPath);
		const componentDir = dirname(tsPath);
		for (const cls of classes) {
			const entity: AffectedEntity = {
				className: cls.className,
				componentFilePath: tsPath,
				kind: cls.kind
			};

			if (cls.kind === 'component') {
				for (const url of [...cls.templateUrls, ...cls.styleUrls]) {
					const abs = safeNormalize(resolve(componentDir, url));
					const existing = resource.get(abs);
					if (existing) existing.push(entity);
					else resource.set(abs, [entity]);
				}
			}

			if (cls.extendsName !== null) {
				const parentPath = resolveParentClassFile(
					cls.extendsName,
					tsPath,
					userAngularRoot
				);
				if (
					parentPath !== null &&
					parentPath !== safeNormalize(tsPath)
				) {
					const existing = parentFile.get(parentPath);
					if (existing) existing.push(entity);
					else parentFile.set(parentPath, [entity]);
				}
			}
		}
	}

	const bundle: IndexBundle = { parentFile, resource };
	indexByRoot.set(userAngularRoot, bundle);
	return bundle;
};

const getOrBuildResourceIndex = (userAngularRoot: string): ResourceIndex =>
	getOrBuildIndexes(userAngularRoot).resource;

/* Returns the list of Angular entities (components, directives,
 * etc.) whose declared class extends a class declared in
 * `changedFilePath`. Empty if the changed file is not a parent of
 * any tracked Angular entity, OR if the parent class is itself
 * Angular-decorated (those route through their own HMR path).
 * Used by the dispatcher to detect edits to plain utility base
 * classes that should trigger a Tier 1b rebootstrap so the
 * extending children see the new parent methods. */
export const resolveDescendantsOfParent = (params: {
	changedFilePath: string;
	userAngularRoot: string;
}): AffectedEntity[] => {
	const norm = safeNormalize(params.changedFilePath);
	let rootStat: ReturnType<typeof statSync>;
	try {
		rootStat = statSync(params.userAngularRoot);
	} catch {
		return [];
	}
	if (!rootStat.isDirectory()) return [];
	const bundle = getOrBuildIndexes(params.userAngularRoot);
	return bundle.parentFile.get(norm) ?? [];
};

/* Drop the resource and parent-file indexes. Called from the
 * dispatcher when a `.ts` edit lands so the next `.html` /
 * `.css` / etc. edit rebuilds with the latest `templateUrl` /
 * `styleUrl` and heritage mappings. */
export const invalidateResourceIndex = (): void => {
	indexByRoot.clear();
};
