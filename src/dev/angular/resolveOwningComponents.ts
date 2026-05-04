/* Resolve a changed file → list of `(componentFilePath, className)`
 * tuples that should receive a fresh `applyMetadata` module.
 *
 * Cases:
 *   1. The changed file itself is a `*.component.ts` — parse it and
 *      return every `@Component`-decorated class declaration.
 *   2. The changed file is a `*.component.html` / `*.component.css`
 *      — scan every `*.component.ts` under the user's Angular root,
 *      find ones whose `templateUrl` / `styleUrl` / `styleUrls`
 *      resolves to the changed path, and return their classes.
 *
 * v1 does the scan on every call. The scan is bounded by the user's
 * Angular dir (typically <100 files) and each file parse is ~1ms,
 * so the whole resolution lands well under 100ms even for medium
 * codebases. Add a caching layer if we ever see this become a
 * bottleneck — `componentFilePath → { templateUrlAbs, styleUrlAbs[],
 * classNames[] }` keyed by mtime is the obvious shape. */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import ts from 'typescript';

export type OwningComponent = {
	componentFilePath: string;
	className: string;
};

const isComponentTsFile = (file: string): boolean =>
	file.endsWith('.component.ts') || file.endsWith('.component.tsx');

const walkComponentTsFiles = (root: string): string[] => {
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
			} else if (entry.isFile() && isComponentTsFile(entry.name)) {
				out.push(full);
			}
		}
	};
	visit(root);

	return out;
};

type ComponentDecoratorRefs = {
	classNames: string[];
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

const parseComponentRefs = (filePath: string): ComponentDecoratorRefs => {
	const refs: ComponentDecoratorRefs = {
		classNames: [],
		templateUrls: [],
		styleUrls: []
	};

	let source: string;
	try {
		source = readFileSync(filePath, 'utf8');
	} catch {
		return refs;
	}

	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.ES2022,
		true,
		ts.ScriptKind.TS
	);

	const visit = (node: ts.Node) => {
		if (ts.isClassDeclaration(node) && node.name) {
			const decorators = ts.getDecorators(node) ?? [];
			for (const decorator of decorators) {
				const expr = decorator.expression;
				if (!ts.isCallExpression(expr)) continue;
				const fn = expr.expression;
				if (!ts.isIdentifier(fn) || fn.text !== 'Component') continue;

				refs.classNames.push(node.name.text);
				const arg = expr.arguments[0];
				if (!arg || !ts.isObjectLiteralExpression(arg)) continue;

				const tplUrl = getStringPropertyValue(arg, 'templateUrl');
				if (tplUrl) refs.templateUrls.push(tplUrl);

				const styleUrl = getStringPropertyValue(arg, 'styleUrl');
				if (styleUrl) refs.styleUrls.push(styleUrl);

				refs.styleUrls.push(...getStringArrayProperty(arg, 'styleUrls'));
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return refs;
};

const safeNormalize = (path: string): string =>
	resolve(path).replace(/\\/g, '/');

export const resolveOwningComponents = (params: {
	changedFilePath: string;
	userAngularRoot: string;
}): OwningComponent[] => {
	const { changedFilePath, userAngularRoot } = params;
	const changedAbs = safeNormalize(changedFilePath);
	const out: OwningComponent[] = [];

	if (changedAbs.endsWith('.component.ts')) {
		const refs = parseComponentRefs(changedAbs);
		for (const className of refs.classNames) {
			out.push({ componentFilePath: changedAbs, className });
		}

		return out;
	}

	const ext = extname(changedAbs).toLowerCase();
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

	for (const componentTsPath of walkComponentTsFiles(userAngularRoot)) {
		const refs = parseComponentRefs(componentTsPath);
		const componentDir = dirname(componentTsPath);

		const matchesResource = (relativeUrl: string): boolean => {
			const abs = safeNormalize(resolve(componentDir, relativeUrl));

			return abs === changedAbs;
		};

		const referencesChanged =
			refs.templateUrls.some(matchesResource) ||
			refs.styleUrls.some(matchesResource);
		if (!referencesChanged) continue;

		for (const className of refs.classNames) {
			out.push({
				componentFilePath: componentTsPath,
				className
			});
		}
	}

	return out;
};
