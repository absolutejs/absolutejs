/* Build-time transform: rewrite an island-registry module so its
 * `defineIslandRegistry({...})` component entries become lazy
 * `IslandComponentDefinition` objects (`{ component, source, export }`) and the
 * raw cross-framework component imports are dropped.
 *
 * Why: the registry (authored with ergonomic raw imports, e.g.
 * `react: { ReactCounter }`) is imported by every framework's host page. When
 * a host of framework X is bundled, X's bundler must resolve those imports —
 * but cross-framework sources (`.tsx`/`.svelte`/`.vue`) can't be bundled into a
 * single framework's output (e.g. the Vue server build has no Svelte loader),
 * so the build fails (`Could not resolve "../react/components/ReactCounter"`).
 *
 * The SSR runtime already resolves `{ source, export }` definitions lazily
 * (see `src/core/renderIslandMarkup.ts` -> `resolveIslandComponent` ->
 * `getIslandBuildReference`), and client cross-framework hydration is handled
 * independently by the per-island entry bundles (`generateIslandEntryPoints`).
 * So replacing the eager imports with definitions in the *bundled* view of the
 * registry keeps the host bundles lean (only their own framework's components
 * are eager) and unblocks the build — with no runtime changes. The author's
 * source registry is untouched (it keeps its raw imports for typing and the
 * build's static analysis, which reads the original file, not this output). */

import { basename } from 'node:path';
import type { BunPlugin } from 'bun';
import ts from 'typescript';
import type { IslandFramework } from '../../types/island';

type IslandDefinitionLite = {
	buildReference: { export?: string; source: string } | null;
	component: string;
	framework: IslandFramework;
};

export type IslandRegistryTransformInfo = {
	definitions: IslandDefinitionLite[];
	resolvedRegistryPath: string;
};

const VALID_FRAMEWORKS: IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular'
];

const getObjectPropertyName = (name: ts.PropertyName) =>
	ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

const isIslandRegistryHelperImport = (source: string) =>
	source === '@absolutejs/absolute/islands' ||
	source.endsWith('/islands') ||
	source.endsWith('/core/islands');

// Local names bound to `defineIslandRegistry` (named import or namespace).
const collectRegistryFactory = (sourceFile: ts.SourceFile) => {
	const factoryNames = new Set<string>();
	const namespaceNames = new Set<string>();

	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!isIslandRegistryHelperImport(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings) continue;
		if (ts.isNamespaceImport(bindings)) {
			namespaceNames.add(bindings.name.text);
			continue;
		}
		if (!ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			const imported = element.propertyName?.text ?? element.name.text;
			if (imported === 'defineIslandRegistry') {
				factoryNames.add(element.name.text);
			}
		}
	}

	return { factoryNames, namespaceNames };
};

const isDefineIslandRegistryCall = (
	expression: ts.Expression,
	factoryNames: Set<string>,
	namespaceNames: Set<string>
) => {
	if (ts.isIdentifier(expression)) return factoryNames.has(expression.text);

	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === 'defineIslandRegistry' &&
		ts.isIdentifier(expression.expression) &&
		namespaceNames.has(expression.expression.text)
	);
};

const findDefineIslandRegistryCall = (
	sourceFile: ts.SourceFile,
	factoryNames: Set<string>,
	namespaceNames: Set<string>
): ts.CallExpression | null => {
	let found: ts.CallExpression | null = null;

	const visit = (node: ts.Node) => {
		if (found) return;
		const [firstArg] = ts.isCallExpression(node) ? node.arguments : [];
		if (
			ts.isCallExpression(node) &&
			isDefineIslandRegistryCall(
				node.expression,
				factoryNames,
				namespaceNames
			) &&
			firstArg &&
			ts.isObjectLiteralExpression(firstArg)
		) {
			found = node;

			return;
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);

	return found;
};

const quoteKey = (key: string) =>
	/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);

const definitionLiteral = (reference: { export?: string; source: string }) => {
	const exportPart = reference.export
		? `, export: ${JSON.stringify(reference.export)}`
		: '';

	return `{ component: null, source: ${JSON.stringify(reference.source)}${exportPart} }`;
};

type Edit = { end: number; start: number; text: string };

export const transformIslandRegistrySource = (
	source: string,
	filePath: string,
	info: IslandRegistryTransformInfo
): string | null => {
	if (!source.includes('defineIslandRegistry')) return null;

	const scriptKind =
		filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
			? ts.ScriptKind.TSX
			: ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind
	);

	const { factoryNames, namespaceNames } = collectRegistryFactory(sourceFile);
	if (factoryNames.size === 0 && namespaceNames.size === 0) return null;

	const call = findDefineIslandRegistryCall(
		sourceFile,
		factoryNames,
		namespaceNames
	);
	if (!call) return null;
	const [objectLiteral] = call.arguments;
	if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) {
		return null;
	}

	const definitionLookup = new Map<
		string,
		{ export?: string; source: string }
	>();
	for (const definition of info.definitions) {
		if (!definition.buildReference) continue;
		definitionLookup.set(`${definition.framework}:${definition.component}`, {
			export: definition.buildReference.export,
			source: definition.buildReference.source
		});
	}

	const edits: Edit[] = [];
	const replacedLocals = new Set<string>();

	for (const frameworkProperty of objectLiteral.properties) {
		if (!ts.isPropertyAssignment(frameworkProperty)) continue;
		const frameworkName = getObjectPropertyName(frameworkProperty.name);
		const framework = VALID_FRAMEWORKS.find((f) => f === frameworkName);
		if (!framework) continue;
		if (!ts.isObjectLiteralExpression(frameworkProperty.initializer)) continue;

		for (const componentProperty of frameworkProperty.initializer
			.properties) {
			let componentKey: string | null = null;
			let localName: string | null = null;
			let replaceNode: ts.Node | null = null;
			let replacementText = '';

			if (ts.isShorthandPropertyAssignment(componentProperty)) {
				componentKey = componentProperty.name.text;
				localName = componentProperty.name.text;
				const reference = definitionLookup.get(
					`${framework}:${componentKey}`
				);
				if (!reference) continue;
				replaceNode = componentProperty;
				replacementText = `${quoteKey(componentKey)}: ${definitionLiteral(reference)}`;
			} else if (
				ts.isPropertyAssignment(componentProperty) &&
				ts.isIdentifier(componentProperty.initializer)
			) {
				componentKey = getObjectPropertyName(componentProperty.name);
				localName = componentProperty.initializer.text;
				if (!componentKey) continue;
				const reference = definitionLookup.get(
					`${framework}:${componentKey}`
				);
				if (!reference) continue;
				replaceNode = componentProperty.initializer;
				replacementText = definitionLiteral(reference);
			} else {
				continue;
			}

			edits.push({
				end: replaceNode.getEnd(),
				start: replaceNode.getStart(sourceFile),
				text: replacementText
			});
			replacedLocals.add(localName);
		}
	}

	if (edits.length === 0) return null;

	// Drop import declarations whose bindings are now all unused (they were
	// only referenced as registry component values). Required: cross-framework
	// sources are otherwise unresolvable in a single framework's bundle.
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const clause = statement.importClause;
		if (!clause) continue;

		const localNames: string[] = [];
		if (clause.name) localNames.push(clause.name.text);
		const bindings = clause.namedBindings;
		if (bindings && ts.isNamedImports(bindings)) {
			for (const element of bindings.elements) {
				localNames.push(element.name.text);
			}
		} else if (bindings && ts.isNamespaceImport(bindings)) {
			localNames.push(bindings.name.text);
		}

		if (localNames.length === 0) continue;
		if (localNames.every((name) => replacedLocals.has(name))) {
			edits.push({
				end: statement.getEnd(),
				start: statement.getStart(sourceFile),
				text: ''
			});
		}
	}

	edits.sort((a, b) => b.start - a.start);
	let output = source;
	for (const edit of edits) {
		output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
	}

	return output;
};

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loaderForPath = (filePath: string) => {
	if (filePath.endsWith('.tsx')) return 'tsx';
	if (filePath.endsWith('.jsx')) return 'jsx';
	if (
		filePath.endsWith('.js') ||
		filePath.endsWith('.mjs') ||
		filePath.endsWith('.cjs')
	) {
		return 'js';
	}

	return 'ts';
};

export const createIslandRegistryDefinitionPlugin = (
	info: IslandRegistryTransformInfo
): BunPlugin => {
	// Narrow the onLoad filter to files sharing the registry's basename (covers
	// both the original source and the per-framework transpiled mirrors), so we
	// don't read every module in the build.
	const registryBase = basename(info.resolvedRegistryPath).replace(
		/\.[mc]?[jt]sx?$/,
		''
	);
	const filter = new RegExp(
		`(^|[/\\\\])${escapeRegExp(registryBase)}\\.[mc]?[jt]sx?$`
	);

	return {
		name: 'absolute-island-registry-definitions',
		setup(build) {
			build.onLoad({ filter }, async (args) => {
				const source = await Bun.file(args.path).text();
				const transformed = transformIslandRegistrySource(
					source,
					args.path,
					info
				);
				if (transformed === null) return undefined;

				return {
					contents: transformed,
					loader: loaderForPath(args.path)
				};
			});
		}
	};
};
