/* Resolve a changed file → list of `(filePath, className, kind)`
 * tuples that should receive a fresh surgical update.
 *
 * Cases:
 *   1. The changed file is a `*.component.ts` / `*.directive.ts` /
 *      `*.pipe.ts` / `*.service.ts` (or any `.ts` file whose top-level
 *      classes carry the matching Angular decorators) — parse it and
 *      return every decorated class.
 *   2. The changed file is a `*.component.html` / `*.component.css`
 *      / `*.scss` / `*.sass` — scan every `*.component.ts` under the
 *      user's Angular root, find ones whose `templateUrl` /
 *      `styleUrl` / `styleUrls` resolves to the changed path, and
 *      return their classes.
 *
 * v1 does the scan on every call. The scan is bounded by the user's
 * Angular dir (typically <100 files) and each file parse is ~1ms,
 * so the whole resolution lands well under 100ms even for medium
 * codebases. */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';

export type AngularEntityKind =
	| 'component'
	| 'directive'
	| 'pipe'
	| 'service';

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

				const entry: DecoratedClass = {
					className: node.name.text,
					kind,
					styleUrls: [],
					templateUrls: []
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
					entry.styleUrls.push(...getStringArrayProperty(arg, 'styleUrls'));
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
	if (ext !== '.html' && ext !== '.css' && ext !== '.scss' && ext !== '.sass') {
		return out;
	}

	let rootStat: ReturnType<typeof statSync>;
	try {
		rootStat = statSync(userAngularRoot);
	} catch {
		return out;
	}
	if (!rootStat.isDirectory()) return out;

	for (const tsPath of walkAngularSourceFiles(userAngularRoot)) {
		const classes = parseDecoratedClasses(tsPath);
		const componentDir = dirname(tsPath);

		const matchesResource = (relativeUrl: string): boolean => {
			const abs = safeNormalize(resolve(componentDir, relativeUrl));

			return abs === changedAbs;
		};

		for (const cls of classes) {
			if (cls.kind !== 'component') continue;
			const referencesChanged =
				cls.templateUrls.some(matchesResource) ||
				cls.styleUrls.some(matchesResource);
			if (!referencesChanged) continue;
			out.push({
				className: cls.className,
				componentFilePath: tsPath,
				kind: 'component'
			});
		}
	}

	return out;
};
