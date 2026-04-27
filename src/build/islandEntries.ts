import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { IslandFramework, IslandRegistryInput } from '../../types/island';
import { getIslandBuildReference } from '../core/islands';

type RegistryModuleExport = {
	default?: unknown;
	islandRegistry?: unknown;
};

type IslandBuildEntry = {
	component: string;
	entryPath: string;
	framework: IslandFramework;
};

type IslandDefinition = {
	buildReference: {
		export?: string;
		source: string;
	} | null;
	component: string;
	framework: IslandFramework;
};

type IslandRegistryBuildInfo = {
	definitions: IslandDefinition[];
	hasNamedExport: boolean;
	registry: IslandRegistryInput;
	resolvedRegistryPath: string;
};

type ParsedImportReference = {
	export?: string;
	source: string;
};

type ParsedRegistryBuildInfo = {
	definitions: IslandDefinition[];
	hasNamedExport: boolean;
	registry: IslandRegistryInput;
};

type IslandEntryPathMaps = Partial<
	Record<IslandFramework, Map<string, string>>
>;

const frameworks: IslandFramework[] = ['react', 'svelte', 'vue', 'angular'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const resolveRegistryExport = (mod: RegistryModuleExport) => {
	if (isRecord(mod.islandRegistry)) return mod.islandRegistry;
	if (isRecord(mod.default)) return mod.default;

	throw new Error(
		'Island registry module must export `islandRegistry` or a default registry object.'
	);
};

const hasSvelteImport = (source: string) =>
	/from\s+['"][^'"]+\.svelte['"]/.test(source);

const normalizeImportPath = (wrapperPath: string, targetPath: string) => {
	const importPath = relative(dirname(wrapperPath), targetPath).replace(
		/\\/g,
		'/'
	);

	return importPath.startsWith('.') ? importPath : `./${importPath}`;
};

const isIdentifier = (value: string) =>
	/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);

const resolveIslandSourcePath = (registryPath: string, sourcePath: string) => {
	if (sourcePath.startsWith('file://')) {
		return new URL(sourcePath).pathname;
	}

	return resolve(dirname(registryPath), sourcePath);
};

const getObjectPropertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
		return name.text;
	}

	return null;
};

const collectDefaultImport = (
	imports: Map<string, ParsedImportReference>,
	importClause: ts.ImportClause,
	source: string
) => {
	if (!importClause.name) return;

	imports.set(importClause.name.text, {
		export: 'default',
		source
	});
};

const collectNamedImports = (
	imports: Map<string, ParsedImportReference>,
	importClause: ts.ImportClause,
	source: string
) => {
	const bindings = importClause.namedBindings;
	if (!bindings || !ts.isNamedImports(bindings)) return;

	for (const element of bindings.elements) {
		imports.set(element.name.text, {
			export: element.propertyName?.text ?? element.name.text,
			source
		});
	}
};

const isIslandRegistryHelperImport = (source: string) =>
	source === '@absolutejs/absolute/islands' ||
	source.endsWith('/islands') ||
	source.endsWith('/core/islands');

const collectRegistryHelperImports = (
	importClause: ts.ImportClause,
	source: string,
	registryFactoryNames: Set<string>,
	registryNamespaceNames: Set<string>
) => {
	if (!isIslandRegistryHelperImport(source)) return;

	const bindings = importClause.namedBindings;
	if (!bindings) return;

	if (ts.isNamespaceImport(bindings)) {
		registryNamespaceNames.add(bindings.name.text);

		return;
	}

	for (const element of bindings.elements) {
		const importedName = element.propertyName?.text ?? element.name.text;
		if (importedName === 'defineIslandRegistry') {
			registryFactoryNames.add(element.name.text);
		}
	}
};

const createRegistryEntryValue = (reference: ParsedImportReference) => ({
	component: reference.source,
	export: reference.export,
	source: reference.source
});

const addRegistryEntries = (
	frameworkNode: ts.ObjectLiteralExpression,
	framework: IslandFramework,
	imports: Map<string, ParsedImportReference>,
	definitions: IslandDefinition[],
	registry: IslandRegistryInput
) => {
	const frameworkRegistry = registry[framework] ?? {};
	registry[framework] = frameworkRegistry;

	for (const property of frameworkNode.properties) {
		if (
			!ts.isPropertyAssignment(property) &&
			!ts.isShorthandPropertyAssignment(property)
		)
			continue;

		const componentName = getObjectPropertyName(property.name);
		if (!componentName) continue;

		const initializer = ts.isPropertyAssignment(property)
			? property.initializer
			: property.name;
		if (!ts.isIdentifier(initializer)) continue;

		const reference = imports.get(initializer.text);
		if (!reference) continue;

		frameworkRegistry[componentName] = createRegistryEntryValue(reference);
		definitions.push({
			buildReference: reference,
			component: componentName,
			framework
		});
	}
};

const processDefineIslandRegistry = (
	node: ts.CallExpression,
	imports: Map<string, ParsedImportReference>,
	definitions: IslandDefinition[],
	registry: IslandRegistryInput
) => {
	const [firstArg] = node.arguments;
	if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return;

	const validFrameworks: IslandFramework[] = [
		'react',
		'svelte',
		'vue',
		'angular'
	];
	for (const property of firstArg.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const frameworkName = getObjectPropertyName(property.name);
		if (!frameworkName) continue;
		const framework = validFrameworks.find((f) => f === frameworkName);
		if (!framework) continue;
		if (!ts.isObjectLiteralExpression(property.initializer)) continue;

		addRegistryEntries(
			property.initializer,
			framework,
			imports,
			definitions,
			registry
		);
	}
};

const walkRegistryNode = (
	node: ts.Node,
	imports: Map<string, ParsedImportReference>,
	registryFactoryNames: Set<string>,
	registryNamespaceNames: Set<string>,
	definitions: IslandDefinition[],
	registry: IslandRegistryInput
) => {
	if (
		ts.isCallExpression(node) &&
		isDefineIslandRegistryCall(
			node.expression,
			registryFactoryNames,
			registryNamespaceNames
		)
	) {
		processDefineIslandRegistry(node, imports, definitions, registry);
	}

	ts.forEachChild(node, (child) =>
		walkRegistryNode(
			child,
			imports,
			registryFactoryNames,
			registryNamespaceNames,
			definitions,
			registry
		)
	);
};

const isDefineIslandRegistryCall = (
	expression: ts.Expression,
	registryFactoryNames: Set<string>,
	registryNamespaceNames: Set<string>
) => {
	if (ts.isIdentifier(expression)) {
		return registryFactoryNames.has(expression.text);
	}

	return (
		ts.isPropertyAccessExpression(expression) &&
		expression.name.text === 'defineIslandRegistry' &&
		ts.isIdentifier(expression.expression) &&
		registryNamespaceNames.has(expression.expression.text)
	);
};

const hasIslandRegistryNamedExport = (sourceFile: ts.SourceFile) => {
	for (const statement of sourceFile.statements) {
		if (
			ts.isVariableStatement(statement) &&
			statement.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
			) &&
			statement.declarationList.declarations.some(
				(declaration) =>
					ts.isIdentifier(declaration.name) &&
					declaration.name.text === 'islandRegistry'
			)
		) {
			return true;
		}

		if (!ts.isExportDeclaration(statement) || !statement.exportClause)
			continue;
		if (!ts.isNamedExports(statement.exportClause)) continue;

		if (
			statement.exportClause.elements.some(
				(element) => element.name.text === 'islandRegistry'
			)
		) {
			return true;
		}
	}

	return false;
};

const collectImportDeclarations = (
	sourceFile: ts.SourceFile,
	registryPath: string,
	imports: Map<string, ParsedImportReference>,
	registryFactoryNames: Set<string>,
	registryNamespaceNames: Set<string>
) => {
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		)
			continue;

		const { importClause } = statement;
		if (!importClause) continue;

		const source = resolveIslandSourcePath(
			registryPath,
			statement.moduleSpecifier.text
		);

		collectDefaultImport(imports, importClause, source);
		collectNamedImports(imports, importClause, source);
		collectRegistryHelperImports(
			importClause,
			statement.moduleSpecifier.text,
			registryFactoryNames,
			registryNamespaceNames
		);
	}
};

const parseIslandRegistryBuildInfo = (
	registrySource: string,
	registryPath: string
): ParsedRegistryBuildInfo => {
	const sourceFile = ts.createSourceFile(
		registryPath,
		registrySource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const imports = new Map<string, ParsedImportReference>();
	const registryFactoryNames = new Set<string>(['defineIslandRegistry']);
	const registryNamespaceNames = new Set<string>();
	const definitions: IslandDefinition[] = [];
	const registry: IslandRegistryInput = {};

	collectImportDeclarations(
		sourceFile,
		registryPath,
		imports,
		registryFactoryNames,
		registryNamespaceNames
	);
	walkRegistryNode(
		sourceFile,
		imports,
		registryFactoryNames,
		registryNamespaceNames,
		definitions,
		registry
	);

	return {
		definitions,
		hasNamedExport: hasIslandRegistryNamedExport(sourceFile),
		registry
	};
};

const loadDynamicIslandRegistryBuildInfo = async (
	resolvedRegistryPath: string
) => {
	const registryModule: RegistryModuleExport = await import(
		resolvedRegistryPath
	);
	const registry: IslandRegistryInput = resolveRegistryExport(registryModule);
	const definitions = frameworks.flatMap((framework) => {
		const frameworkRegistry = registry[framework];
		if (!isRecord(frameworkRegistry)) return [];

		return Object.entries(frameworkRegistry).map(([component, value]) => ({
			buildReference: getIslandBuildReference(value),
			component,
			framework
		}));
	});

	return {
		definitions,
		hasNamedExport: isRecord(registryModule.islandRegistry),
		registry
	};
};

const createRegistryImportCode = (
	wrapperPath: string,
	registryPath: string,
	hasNamedExport: boolean
) => {
	const normalizedPath = normalizeImportPath(wrapperPath, registryPath);

	if (hasNamedExport) {
		return {
			importStatement: `import { islandRegistry as __absoluteIslandRegistry } from ${JSON.stringify(normalizedPath)};`,
			registryReference: '__absoluteIslandRegistry'
		};
	}

	return {
		importStatement: `import __absoluteIslandRegistry from ${JSON.stringify(normalizedPath)};`,
		registryReference: '__absoluteIslandRegistry'
	};
};

const createDirectEntrySource = (
	wrapperPath: string,
	importPath: string,
	exportName?: string
) => {
	const normalizedImportPath = normalizeImportPath(wrapperPath, importPath);
	if (!exportName || exportName === 'default') {
		return `export { default } from ${JSON.stringify(normalizedImportPath)};\n`;
	}

	return `export { ${exportName} as default } from ${JSON.stringify(normalizedImportPath)};\n`;
};

const createRegistryEntrySource = (
	wrapperPath: string,
	registryPath: string,
	hasNamedExport: boolean,
	framework: IslandFramework,
	component: string
) => {
	const { importStatement, registryReference } = createRegistryImportCode(
		wrapperPath,
		registryPath,
		hasNamedExport
	);
	const frameworkAccess = isIdentifier(framework)
		? `${registryReference}.${framework}`
		: `${registryReference}[${JSON.stringify(framework)}]`;
	const componentAccess = isIdentifier(component)
		? `${frameworkAccess}.${component}`
		: `${frameworkAccess}[${JSON.stringify(component)}]`;

	return `${importStatement}

const component = ${componentAccess};

export default component;
`;
};

const shouldUseCompiledClientPath = (
	framework: IslandFramework,
	sourcePath: string
) => {
	if (framework === 'svelte') {
		return /\.svelte(?:\.(?:ts|js))?$/.test(sourcePath);
	}

	if (framework === 'vue') {
		return extname(sourcePath) === '.vue';
	}

	if (framework === 'angular') {
		return /\.(?:ts|js|tsx|jsx|mjs|cjs)$/.test(sourcePath);
	}

	return false;
};

export const collectIslandFrameworkSources = (
	buildInfo: IslandRegistryBuildInfo
) => {
	const sources: Partial<Record<IslandFramework, string[]>> = {};

	for (const definition of buildInfo.definitions) {
		const { buildReference } = definition;
		if (!buildReference) continue;

		const resolvedSourcePath = resolveIslandSourcePath(
			buildInfo.resolvedRegistryPath,
			buildReference.source
		);
		if (
			!shouldUseCompiledClientPath(
				definition.framework,
				resolvedSourcePath
			)
		)
			continue;

		const frameworkSources = sources[definition.framework] ?? [];
		if (frameworkSources.includes(resolvedSourcePath)) continue;

		frameworkSources.push(resolvedSourcePath);
		sources[definition.framework] = frameworkSources;
	}

	return sources;
};
export const generateIslandEntryPoints = async ({
	buildInfo,
	buildPath,
	clientPathMaps = {}
}: {
	buildInfo: IslandRegistryBuildInfo;
	buildPath: string;
	clientPathMaps?: IslandEntryPathMaps;
}) => {
	const generatedRoot = join(buildPath, '_island_entries');

	rmSync(generatedRoot, { force: true, recursive: true });

	const entries: IslandBuildEntry[] = [];

	for (const definition of buildInfo.definitions) {
		const entryPath = join(
			generatedRoot,
			'islands',
			definition.framework,
			`${definition.component}.ts`
		);
		const { buildReference } = definition;
		const source = buildReference
			? resolveIslandSourcePath(
					buildInfo.resolvedRegistryPath,
					buildReference.source
				)
			: null;
		const compiledSourcePath =
			source && shouldUseCompiledClientPath(definition.framework, source)
				? clientPathMaps[definition.framework]?.get(source)
				: undefined;
		const entrySource =
			source &&
			(compiledSourcePath ||
				!shouldUseCompiledClientPath(definition.framework, source))
				? createDirectEntrySource(
						entryPath,
						compiledSourcePath ?? source,
						compiledSourcePath ? undefined : buildReference?.export
					)
				: createRegistryEntrySource(
						entryPath,
						buildInfo.resolvedRegistryPath,
						buildInfo.hasNamedExport,
						definition.framework,
						definition.component
					);

		mkdirSync(dirname(entryPath), { recursive: true });
		writeFileSync(entryPath, entrySource);
		entries.push({
			component: definition.component,
			entryPath,
			framework: definition.framework
		});
	}

	return {
		entries,
		generatedRoot
	};
};
export const loadIslandRegistryBuildInfo = async (
	registryPath: string
): Promise<IslandRegistryBuildInfo> => {
	const resolvedRegistryPath = resolve(registryPath);
	const registrySource = Bun.file(resolvedRegistryPath);
	const registrySourceText = await registrySource.text();
	const parsedInfo = parseIslandRegistryBuildInfo(
		registrySourceText,
		resolvedRegistryPath
	);
	if (parsedInfo.definitions.length > 0) {
		return {
			definitions: parsedInfo.definitions,
			hasNamedExport: parsedInfo.hasNamedExport,
			registry: parsedInfo.registry,
			resolvedRegistryPath
		};
	}
	if (hasSvelteImport(registrySourceText)) {
		throw new Error(
			'Unable to statically analyze the island registry. Registries that import .svelte files must use defineIslandRegistry({ ... }) with direct imported component references.'
		);
	}

	const dynamicInfo =
		await loadDynamicIslandRegistryBuildInfo(resolvedRegistryPath);

	return {
		definitions: dynamicInfo.definitions,
		hasNamedExport: dynamicInfo.hasNamedExport,
		registry: dynamicInfo.registry,
		resolvedRegistryPath
	};
};
