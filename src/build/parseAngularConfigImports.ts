/* Build-time AST pass over `absolute.config.ts`. Reads the import path
 * the user's `angular.providers` field references so `compileAngular`'s
 * providers-injection step can append a matching
 * `import { appProviders } from "..."` plus an
 * `export const providers = [...]` declaration directly into every
 * page's compiled server output.
 *
 * Why AST: the framework already loads the config at build time (to
 * get the runtime values), but the runtime value of
 * `angular.providers` is an array of Angular `Provider` /
 * `EnvironmentProviders` objects — a graph of function references
 * that can't be serialized back to source. The path string is the
 * only piece the build needs in text form, and the source code is
 * where it actually lives. */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

export type AngularProvidersImport = {
	/** Local binding name as referenced in the config (e.g. `appProviders`). */
	bindingName: string;
	/** Original exported name on the source module. */
	importedName: string;
	/** Resolved absolute path to the providers module (no extension). */
	absolutePath: string;
};

const withoutExtension = (path: string) => path.replace(/\.[cm]?[tj]sx?$/, '');

/* The object passed to `defineConfig(...)`, when `node` is that call. */
const defineConfigArgument = (node: TS.Node) => {
	if (
		!ts.isCallExpression(node) ||
		!ts.isIdentifier(node.expression) ||
		node.expression.text !== 'defineConfig'
	)
		return null;
	const [argument] = node.arguments;

	return argument && ts.isObjectLiteralExpression(argument) ? argument : null;
};

/* The first `defineConfig({ … })` in the file, in document order. */
const findDefineConfigCall = (sourceFile: TS.SourceFile) => {
	const pending: TS.Node[] = [sourceFile];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) break;
		const found = defineConfigArgument(node);
		if (found) return found;
		const children: TS.Node[] = [];
		ts.forEachChild(node, (child) => {
			children.push(child);
		});
		// Popped from the end, so the first child goes on last.
		pending.push(...children.reverse());
	}

	return null;
};

const findPropertyInitializer = (
	object: TS.ObjectLiteralExpression,
	name: string
) => {
	for (const property of object.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		if (!property.name) continue;
		const key =
			ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
				? property.name.text
				: null;
		if (key === name) return property.initializer;
	}

	return null;
};

const findImportForBinding = (sourceFile: TS.SourceFile, binding: string) => {
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (statement.importClause?.isTypeOnly) continue;
		const named = statement.importClause?.namedBindings;
		if (!named || !ts.isNamedImports(named)) continue;
		const element = named.elements.find(
			(candidate) =>
				!candidate.isTypeOnly && candidate.name.text === binding
		);
		if (!element) continue;

		return {
			importedName: element.propertyName?.text ?? element.name.text,
			source: statement.moduleSpecifier.text
		};
	}

	return null;
};

/** Locate `absolute.config.ts`. Honours the `ABSOLUTE_CONFIG` env var
 *  (same one `src/cli/index.ts` uses to thread `--config` through to
 *  the dev/build runtime), so tests that boot the example app from
 *  the repo root with `ABSOLUTE_CONFIG=example/absolute.config.ts`
 *  find the example's config instead of looking for one at the repo
 *  root. Falls back to `<projectRoot>/absolute.config.{ts,mts,js,mjs}`.
 *  Returns null if no candidate exists — caller treats that as
 *  "no global providers". */
const resolveConfigPath = (projectRoot: string) => {
	const envOverride = process.env.ABSOLUTE_CONFIG;
	if (envOverride) {
		const resolved = isAbsolute(envOverride)
			? envOverride
			: join(projectRoot, envOverride);
		if (existsSync(resolved)) return resolved;
	}

	const candidates = [
		join(projectRoot, 'absolute.config.ts'),
		join(projectRoot, 'absolute.config.mts'),
		join(projectRoot, 'absolute.config.js'),
		join(projectRoot, 'absolute.config.mjs')
	];

	return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

export const parseAngularProvidersImport = (
	projectRoot: string
): AngularProvidersImport | null => {
	const configPath = resolveConfigPath(projectRoot);
	if (!configPath) return null;

	const source = readFileSync(configPath, 'utf-8');
	if (!source.includes('angular')) return null;
	if (!source.includes('providers')) return null;

	const sourceFile = ts.createSourceFile(
		configPath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);

	const configObject = findDefineConfigCall(sourceFile);
	if (!configObject) return null;

	const angularField = findPropertyInitializer(configObject, 'angular');
	if (!angularField || !ts.isObjectLiteralExpression(angularField))
		return null;

	const providersField = findPropertyInitializer(angularField, 'providers');
	if (!providersField) return null;
	if (!ts.isIdentifier(providersField)) return null;

	const binding = providersField.text;
	const importInfo = findImportForBinding(sourceFile, binding);
	if (!importInfo) return null;

	const configDir = dirname(configPath);
	const { source: specifier } = importInfo;
	// A bare package specifier is left exactly as written.
	const nonRelative = isAbsolute(specifier)
		? withoutExtension(specifier)
		: specifier;
	const absolutePath = specifier.startsWith('.')
		? withoutExtension(join(configDir, specifier))
		: nonRelative;

	return {
		absolutePath,
		bindingName: binding,
		importedName: importInfo.importedName
	};
};
