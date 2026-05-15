/* Build-time AST pass over `absolute.config.ts`. Reads the import path
 * the user's `angular.providers` field references so the emitter can
 * write a matching `import { appProviders } from "..."` into every
 * per-page generated providers file.
 *
 * Why AST: the framework already loads the config at build time (to
 * get the runtime values), but the runtime value of
 * `angular.providers` is an array of Angular `Provider` /
 * `EnvironmentProviders` objects — a graph of function references
 * that can't be serialized back to source for the client bundle to
 * import. The path string is the only piece the build needs in text
 * form, and the source code is where it actually lives. */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import ts from 'typescript';

export type AngularProvidersImport = {
	/** Local binding name as referenced in the config (e.g. `appProviders`). */
	bindingName: string;
	/** Original exported name on the source module. */
	importedName: string;
	/** Resolved absolute path to the providers module (no extension). */
	absolutePath: string;
};

const findDefineConfigCall = (
	sf: ts.SourceFile
): ts.ObjectLiteralExpression | null => {
	let result: ts.ObjectLiteralExpression | null = null;

	const visit = (node: ts.Node) => {
		if (result) return;
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineConfig'
		) {
			const [arg] = node.arguments;
			if (arg && ts.isObjectLiteralExpression(arg)) {
				result = arg;

				return;
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sf, visit);

	return result;
};

const findPropertyInitializer = (
	object: ts.ObjectLiteralExpression,
	name: string
): ts.Expression | null => {
	for (const prop of object.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		if (!prop.name) continue;
		const key = ts.isIdentifier(prop.name)
			? prop.name.text
			: ts.isStringLiteral(prop.name)
				? prop.name.text
				: null;
		if (key === name) return prop.initializer;
	}

	return null;
};

const findImportForBinding = (
	sf: ts.SourceFile,
	binding: string
): { source: string; importedName: string } | null => {
	for (const statement of sf.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (statement.importClause?.isTypeOnly) continue;
		const named = statement.importClause?.namedBindings;
		if (!named || !ts.isNamedImports(named)) continue;
		for (const element of named.elements) {
			if (element.isTypeOnly) continue;
			if (element.name.text === binding) {
				return {
					importedName: element.propertyName?.text ?? element.name.text,
					source: statement.moduleSpecifier.text
				};
			}
		}
	}

	return null;
};

/** Locate `absolute.config.ts` at the project root. Returns null if
 *  the file doesn't exist — caller falls back to "no global providers". */
const resolveConfigPath = (projectRoot: string): string | null => {
	const candidates = [
		join(projectRoot, 'absolute.config.ts'),
		join(projectRoot, 'absolute.config.mts'),
		join(projectRoot, 'absolute.config.js'),
		join(projectRoot, 'absolute.config.mjs')
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
};

export const parseAngularProvidersImport = (
	projectRoot: string
): AngularProvidersImport | null => {
	const configPath = resolveConfigPath(projectRoot);
	if (!configPath) return null;

	const source = readFileSync(configPath, 'utf-8');
	if (!source.includes('angular')) return null;
	if (!source.includes('providers')) return null;

	const sf = ts.createSourceFile(
		configPath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	const configObject = findDefineConfigCall(sf);
	if (!configObject) return null;

	const angularField = findPropertyInitializer(configObject, 'angular');
	if (!angularField || !ts.isObjectLiteralExpression(angularField)) return null;

	const providersField = findPropertyInitializer(angularField, 'providers');
	if (!providersField) return null;
	if (!ts.isIdentifier(providersField)) return null;

	const binding = providersField.text;
	const importInfo = findImportForBinding(sf, binding);
	if (!importInfo) return null;

	const configDir = dirname(configPath);
	const absolutePath = importInfo.source.startsWith('.')
		? join(configDir, importInfo.source).replace(/\.[cm]?[tj]sx?$/, '')
		: isAbsolute(importInfo.source)
			? importInfo.source.replace(/\.[cm]?[tj]sx?$/, '')
			: importInfo.source;

	return {
		absolutePath,
		bindingName: binding,
		importedName: importInfo.importedName
	};
};
