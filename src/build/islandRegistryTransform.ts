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
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';
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

const getObjectPropertyName = (name: TS.PropertyName) =>
	ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;

const isIslandRegistryHelperImport = (source: string) =>
	source === '@absolutejs/absolute/islands' ||
	source.endsWith('/islands') ||
	source.endsWith('/core/islands');

// Local names bound to `defineIslandRegistry` (named import or namespace).
const collectRegistryFactory = (sourceFile: TS.SourceFile) => {
	const factoryNames = new Set<string>();
	const namespaceNames = new Set<string>();

	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!isIslandRegistryHelperImport(statement.moduleSpecifier.text))
			continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings) continue;
		if (ts.isNamespaceImport(bindings))
			namespaceNames.add(bindings.name.text);
		if (!ts.isNamedImports(bindings)) continue;
		bindings.elements
			.filter(
				(element) =>
					(element.propertyName?.text ?? element.name.text) ===
					'defineIslandRegistry'
			)
			.forEach((element) => factoryNames.add(element.name.text));
	}

	return { factoryNames, namespaceNames };
};

const isDefineIslandRegistryCall = (
	expression: TS.Expression,
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

/* `node` itself, when it is `defineIslandRegistry({ … })`. */
const registryCallAt = (
	node: TS.Node,
	factoryNames: Set<string>,
	namespaceNames: Set<string>
) => {
	if (!ts.isCallExpression(node)) return null;
	const [firstArg] = node.arguments;

	return isDefineIslandRegistryCall(
		node.expression,
		factoryNames,
		namespaceNames
	) &&
		firstArg &&
		ts.isObjectLiteralExpression(firstArg)
		? node
		: null;
};

/* The first such call in the file, in document order. */
const findDefineIslandRegistryCall = (
	sourceFile: TS.SourceFile,
	factoryNames: Set<string>,
	namespaceNames: Set<string>
) => {
	const pending: TS.Node[] = [sourceFile];
	while (pending.length > 0) {
		const node = pending.pop();
		if (node === undefined) break;
		const call = registryCallAt(node, factoryNames, namespaceNames);
		if (call) return call;
		const children: TS.Node[] = [];
		ts.forEachChild(node, (child) => {
			children.push(child);
		});
		// Popped from the end, so the first child goes on last.
		pending.push(...children.reverse());
	}

	return null;
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

type BuildReference = { export?: string; source: string };

/* One registry entry to rewrite: the edit, and the local name it stops
 * referring to (so its import can go once nothing else uses it). */
type Replacement = { edit: Edit; localName: string };

const replacementOf = (
	node: TS.Node,
	sourceFile: TS.SourceFile,
	text: string,
	localName: string
) => {
	const replacement: Replacement = {
		edit: { end: node.getEnd(), start: node.getStart(sourceFile), text },
		localName
	};

	return replacement;
};

/* `{ Counter }` is replaced whole, key included; `{ key: Counter }` keeps
 * its key and has only the value replaced. Anything else — a call, a
 * spread, a literal — is not a component reference and is left alone. */
const componentReplacement = (
	property: TS.ObjectLiteralElementLike,
	framework: IslandFramework,
	definitionLookup: Map<string, BuildReference>,
	sourceFile: TS.SourceFile
) => {
	if (ts.isShorthandPropertyAssignment(property)) {
		const key = property.name.text;
		const reference = definitionLookup.get(`${framework}:${key}`);

		return reference
			? replacementOf(
					property,
					sourceFile,
					`${quoteKey(key)}: ${definitionLiteral(reference)}`,
					key
				)
			: null;
	}
	if (
		!ts.isPropertyAssignment(property) ||
		!ts.isIdentifier(property.initializer)
	)
		return null;
	const key = getObjectPropertyName(property.name);
	const reference = key
		? definitionLookup.get(`${framework}:${key}`)
		: undefined;

	return reference
		? replacementOf(
				property.initializer,
				sourceFile,
				definitionLiteral(reference),
				property.initializer.text
			)
		: null;
};

/* Every local name one import declaration binds. */
const importedLocalNames = (clause: TS.ImportClause) => {
	const bindings = clause.namedBindings;
	const named =
		bindings && ts.isNamedImports(bindings)
			? bindings.elements.map((element) => element.name.text)
			: [];
	const namespace =
		bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : [];

	return [...(clause.name ? [clause.name.text] : []), ...named, ...namespace];
};

export const transformIslandRegistrySource = (
	source: string,
	filePath: string,
	info: IslandRegistryTransformInfo
) => {
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

	const definitionLookup = new Map<string, BuildReference>();
	for (const definition of info.definitions) {
		if (!definition.buildReference) continue;
		definitionLookup.set(
			`${definition.framework}:${definition.component}`,
			{
				export: definition.buildReference.export,
				source: definition.buildReference.source
			}
		);
	}

	const edits: Edit[] = [];
	const replacedLocals = new Set<string>();

	for (const frameworkProperty of objectLiteral.properties) {
		if (!ts.isPropertyAssignment(frameworkProperty)) continue;
		const frameworkName = getObjectPropertyName(frameworkProperty.name);
		const framework = VALID_FRAMEWORKS.find((f) => f === frameworkName);
		if (!framework) continue;
		if (!ts.isObjectLiteralExpression(frameworkProperty.initializer))
			continue;

		frameworkProperty.initializer.properties
			.map((componentProperty) =>
				componentReplacement(
					componentProperty,
					framework,
					definitionLookup,
					sourceFile
				)
			)
			.filter((replacement) => replacement !== null)
			.forEach(({ edit, localName }) => {
				edits.push(edit);
				replacedLocals.add(localName);
			});
	}

	if (edits.length === 0) return null;

	// Drop import declarations whose bindings are now all unused (they were
	// only referenced as registry component values). Required: cross-framework
	// sources are otherwise unresolvable in a single framework's bundle.
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const clause = statement.importClause;
		if (!clause) continue;

		const localNames = importedLocalNames(clause);
		if (localNames.length === 0) continue;
		if (!localNames.every((name) => replacedLocals.has(name))) continue;
		edits.push({
			end: statement.getEnd(),
			start: statement.getStart(sourceFile),
			text: ''
		});
	}

	edits.sort((left, right) => right.start - left.start);
	let output = source;
	for (const edit of edits) {
		output =
			output.slice(0, edit.start) + edit.text + output.slice(edit.end);
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
