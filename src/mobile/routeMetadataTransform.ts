import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import type { BunPlugin } from 'bun';
import ts from 'typescript';
import { ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION } from './pageProtocol';
import { hashAbsoluteMobilePropsSchema } from './releaseArtifact';
import {
	ABSOLUTE_MOBILE_ROUTE_DETAIL,
	type AbsoluteMobileBuildPageMetadata
} from './buildMetadata';

type MobileRouteTransformOptions = {
	entry: string;
	projectRoot?: string;
};

type AnalyzedPageCall = {
	inputKind: 'object' | 'static';
	metadata: AbsoluteMobileBuildPageMetadata;
	pageCallStart: number;
	routeCallSpan: string;
};

type AnalyzedFile = {
	byPageCall: Map<number, AnalyzedPageCall>;
	byRouteCall: Map<string, AnalyzedPageCall>;
};

type PageHandlerDefinition = {
	bundleProperty?: 'index' | 'indexPath';
	framework: AbsoluteMobileBuildPageMetadata['framework'];
	inputKind?: 'static';
	pageProperty?: 'Page';
	propsProperty: 'props' | 'requestContext';
	sourceProperty?: 'pagePath';
};

type AssetKeyResolver = (
	expression: ts.Expression | undefined,
	checker: ts.TypeChecker,
	seen?: Set<ts.Symbol>
) => string | undefined;

const ROUTE_METHODS = new Set(['get', 'head']);
const SOURCE_FILTER = /\.[cm]?[jt]sx?$/;
const PAGE_HANDLERS = new Map<string, PageHandlerDefinition>([
	[
		'handleHTMLPageRequest',
		{ framework: 'html', inputKind: 'static', propsProperty: 'props' }
	],
	[
		'handleHTMXPageRequest',
		{ framework: 'htmx', inputKind: 'static', propsProperty: 'props' }
	],
	[
		'handleAngularPageRequest',
		{
			bundleProperty: 'indexPath',
			framework: 'angular',
			propsProperty: 'requestContext',
			sourceProperty: 'pagePath'
		}
	],
	[
		'handleReactPageRequest',
		{
			bundleProperty: 'index',
			framework: 'react',
			pageProperty: 'Page',
			propsProperty: 'props'
		}
	],
	[
		'handleSveltePageRequest',
		{
			bundleProperty: 'indexPath',
			framework: 'svelte',
			propsProperty: 'props',
			sourceProperty: 'pagePath'
		}
	],
	[
		'handleVuePageRequest',
		{
			bundleProperty: 'indexPath',
			framework: 'vue',
			propsProperty: 'props',
			sourceProperty: 'pagePath'
		}
	]
]);

const posixPath = (value: string) => value.replace(/\\/g, '/');

const findTsconfig = (entry: string, projectRoot: string) =>
	ts.findConfigFile(dirname(entry), existsSync, 'tsconfig.json') ??
	ts.findConfigFile(projectRoot, existsSync, 'tsconfig.json');

const createProgram = (entry: string, projectRoot: string) => {
	const configPath = findTsconfig(entry, projectRoot);
	if (!configPath) {
		return ts.createProgram([entry], {
			allowJs: true,
			jsx: ts.JsxEmit.ReactJSX,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			target: ts.ScriptTarget.ESNext
		});
	}

	const parsed = ts.parseJsonConfigFileContent(
		ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
			.config,
		ts.sys,
		dirname(configPath)
	);
	if (!parsed.fileNames.includes(entry)) parsed.fileNames.push(entry);

	return ts.createProgram(parsed.fileNames, parsed.options);
};

const propertyName = (property: ts.ObjectLiteralElementLike) => {
	if (!('name' in property) || !property.name) return undefined;
	if (ts.isIdentifier(property.name)) return property.name.text;
	if (ts.isStringLiteralLike(property.name)) return property.name.text;

	return undefined;
};

const objectPropertyExpression = (
	object: ts.ObjectLiteralExpression,
	name: string
) => {
	const property = object.properties.find(
		(candidate) => propertyName(candidate) === name
	);
	if (property && ts.isPropertyAssignment(property)) {
		return property.initializer;
	}
	if (property && ts.isShorthandPropertyAssignment(property)) {
		return property.name;
	}

	return undefined;
};

const serializeType = (
	type: ts.Type,
	checker: ts.TypeChecker,
	ancestors = new Set<ts.Type>()
): unknown => {
	if (type.flags & ts.TypeFlags.Any) return { type: 'any' };
	if (type.flags & ts.TypeFlags.Unknown) return { type: 'unknown' };
	if (type.flags & ts.TypeFlags.Never) return { type: 'never' };
	if (type.flags & ts.TypeFlags.StringLike) return { type: 'string' };
	if (type.flags & ts.TypeFlags.NumberLike) return { type: 'number' };
	if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
	if (type.flags & ts.TypeFlags.BigIntLike) return { type: 'bigint' };
	if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
	if (type.flags & ts.TypeFlags.Undefined) return { type: 'undefined' };
	if (type.isUnion()) {
		return {
			anyOf: type.types
				.map((member) => serializeType(member, checker, ancestors))
				.sort((left, right) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right))
				)
		};
	}
	if (type.isIntersection()) {
		return {
			allOf: type.types
				.map((member) => serializeType(member, checker, ancestors))
				.sort((left, right) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right))
				)
		};
	}
	if (ancestors.has(type)) {
		return {
			ref: checker.typeToString(
				type,
				undefined,
				ts.TypeFormatFlags.NoTruncation
			)
		};
	}

	ancestors.add(type);
	const arrayElement = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
	const properties = checker.getPropertiesOfType(type);
	let schema: unknown;
	if (arrayElement && properties.some(({ name }) => name === 'length')) {
		schema = {
			items: serializeType(arrayElement, checker, ancestors),
			type: 'array'
		};
	} else if (properties.length > 0) {
		const entries = properties
			.filter(({ name }) => !name.startsWith('__'))
			.map((property) => {
				const declaration =
					property.valueDeclaration ?? property.declarations?.[0];
				const propertyType = declaration
					? checker.getTypeOfSymbolAtLocation(property, declaration)
					: checker.getDeclaredTypeOfSymbol(property);

				return [
					property.name,
					{
						optional: Boolean(
							property.flags & ts.SymbolFlags.Optional
						),
						schema: serializeType(propertyType, checker, ancestors)
					}
				] as const;
			})
			.sort(([left], [right]) => left.localeCompare(right));
		schema = { properties: Object.fromEntries(entries), type: 'object' };
	} else {
		schema = {
			type: checker.typeToString(
				type,
				undefined,
				ts.TypeFormatFlags.NoTruncation
			)
		};
	}
	ancestors.delete(type);

	return schema;
};

const pagePropsType = (
	pageExpression: ts.Expression,
	propsExpression: ts.Expression | undefined,
	checker: ts.TypeChecker
) => {
	const pageType = checker.getTypeAtLocation(pageExpression);
	const [signature] = pageType.getCallSignatures();
	const [parameter] = signature?.parameters ?? [];
	const declaration =
		parameter?.valueDeclaration ?? parameter?.declarations?.[0];
	if (parameter && declaration) {
		return checker.getTypeOfSymbolAtLocation(parameter, declaration);
	}

	return propsExpression
		? checker.getTypeAtLocation(propsExpression)
		: checker.getTypeAtLocation(pageExpression);
};

const resolvePageIdentity = (
	expression: ts.Expression,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	projectRoot: string
) => {
	let symbol = checker.getSymbolAtLocation(expression);
	if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) {
		symbol = checker.getAliasedSymbol(symbol);
	}
	const declaration = symbol?.declarations?.[0];
	const file = declaration?.getSourceFile().fileName ?? sourceFile.fileName;
	const exportedName = symbol?.name ?? expression.getText(sourceFile);
	const source = posixPath(relative(projectRoot, file));

	return `${source}#${exportedName}`;
};

const resolveAlias = (symbol: ts.Symbol, checker: ts.TypeChecker) => {
	if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;

	return checker.getAliasedSymbol(symbol);
};

const assetKey: AssetKeyResolver = (
	expression,
	checker,
	seen = new Set<ts.Symbol>()
) => {
	if (!expression) return undefined;

	if (ts.isIdentifier(expression)) {
		const unresolved = ts.isShorthandPropertyAssignment(expression.parent)
			? checker.getShorthandAssignmentValueSymbol(expression.parent)
			: checker.getSymbolAtLocation(expression);
		if (!unresolved) return undefined;
		const symbol = resolveAlias(unresolved, checker);
		if (seen.has(symbol)) return undefined;
		seen.add(symbol);
		const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
		if (!declaration || !ts.isVariableDeclaration(declaration))
			return undefined;

		return assetKey(declaration.initializer, checker, seen);
	}

	if (!ts.isCallExpression(expression)) return undefined;
	if (
		!ts.isIdentifier(expression.expression) ||
		expression.expression.text !== 'asset'
	) {
		return undefined;
	}
	const [, key] = expression.arguments;

	return key && ts.isStringLiteralLike(key) ? key.text : undefined;
};

const staticString = (
	expression: ts.Expression,
	bindings: ReadonlyMap<string, string>
): string | undefined => {
	if (ts.isStringLiteralLike(expression)) return expression.text;
	if (ts.isIdentifier(expression)) return bindings.get(expression.text);
	if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
	if (!ts.isTemplateExpression(expression)) return undefined;
	let value = expression.head.text;
	for (const span of expression.templateSpans) {
		const substitution = staticString(span.expression, bindings);
		if (substitution === undefined) return undefined;
		value += substitution + span.literal.text;
	}

	return value;
};

const assetKeyWithBindings = (
	expression: ts.Expression | undefined,
	checker: ts.TypeChecker,
	bindings: ReadonlyMap<string, string> = new Map()
) => {
	if (!expression) return undefined;
	if (
		ts.isCallExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === 'asset'
	) {
		const [, key] = expression.arguments;

		return key ? staticString(key, bindings) : undefined;
	}

	return assetKey(expression, checker);
};

const callableObject = (call: ts.CallExpression, checker: ts.TypeChecker) => {
	const symbol = checker.getSymbolAtLocation(call.expression);
	const resolved = symbol ? resolveAlias(symbol, checker) : undefined;
	const declaration =
		resolved?.valueDeclaration ?? resolved?.declarations?.[0];
	let callable:
		| ts.ArrowFunction
		| ts.FunctionDeclaration
		| ts.FunctionExpression
		| undefined;
	if (declaration && ts.isFunctionDeclaration(declaration)) {
		callable = declaration;
	} else if (
		declaration &&
		ts.isVariableDeclaration(declaration) &&
		declaration.initializer &&
		(ts.isArrowFunction(declaration.initializer) ||
			ts.isFunctionExpression(declaration.initializer))
	) {
		callable = declaration.initializer;
	}
	if (!callable) return undefined;
	const bindings = new Map<string, string>();
	callable.parameters.forEach((parameter, index) => {
		if (!ts.isIdentifier(parameter.name)) return;
		const argument = call.arguments[index];
		if (!argument) return;
		const value = staticString(argument, new Map());
		if (value !== undefined) bindings.set(parameter.name.text, value);
	});
	const { body } = callable;
	if (!body) return undefined;
	const expressionBody = ts.isParenthesizedExpression(body)
		? body.expression
		: body;
	if (ts.isObjectLiteralExpression(expressionBody)) {
		return { bindings, object: expressionBody };
	}
	if (ts.isBlock(body)) {
		const returned = body.statements.find(ts.isReturnStatement)?.expression;
		if (returned && ts.isObjectLiteralExpression(returned)) {
			return { bindings, object: returned };
		}
	}

	return undefined;
};

const spreadObject = (
	expression: ts.Expression,
	checker: ts.TypeChecker,
	bindings: ReadonlyMap<string, string>
) => {
	if (ts.isObjectLiteralExpression(expression)) {
		return { bindings, object: expression };
	}
	if (!ts.isCallExpression(expression)) return undefined;

	return callableObject(expression, checker);
};

const objectAssetKey = (
	object: ts.ObjectLiteralExpression,
	name: string,
	checker: ts.TypeChecker,
	bindings: ReadonlyMap<string, string> = new Map()
): string | undefined => {
	for (const property of [...object.properties].reverse()) {
		if (
			propertyName(property) === name &&
			ts.isShorthandPropertyAssignment(property)
		) {
			return assetKeyWithBindings(property.name, checker, bindings);
		}
		if (
			propertyName(property) === name &&
			ts.isPropertyAssignment(property)
		) {
			return assetKeyWithBindings(
				property.initializer,
				checker,
				bindings
			);
		}
		if (!ts.isSpreadAssignment(property)) continue;
		const nestedObject = spreadObject(
			property.expression,
			checker,
			bindings
		);
		if (!nestedObject) continue;
		const nested = objectAssetKey(
			nestedObject.object,
			name,
			checker,
			nestedObject.bindings
		);
		if (nested) return nested;
	}

	return undefined;
};

const findPageCall = (nodes: readonly ts.Node[]) => {
	let found:
		| { definition: PageHandlerDefinition; node: ts.CallExpression }
		| undefined;
	const visit = (candidate: ts.Node) => {
		if (found) return;
		if (
			ts.isCallExpression(candidate) &&
			ts.isIdentifier(candidate.expression) &&
			PAGE_HANDLERS.has(candidate.expression.text)
		) {
			const definition = PAGE_HANDLERS.get(candidate.expression.text);
			if (!definition) return;
			found = { definition, node: candidate };

			return;
		}
		ts.forEachChild(candidate, visit);
	};
	for (const node of nodes) visit(node);

	return found;
};

const isProjectSource = (
	sourceFile: ts.SourceFile,
	resolvedFile: string,
	projectRoot: string
) =>
	!sourceFile.isDeclarationFile &&
	!resolvedFile.includes('/node_modules/') &&
	resolvedFile.startsWith(`${projectRoot}/`);

const analyzeRouteCall = (
	node: ts.CallExpression,
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	projectRoot: string
) => {
	const callee = node.expression;
	if (!ts.isPropertyAccessExpression(callee)) return undefined;
	if (!ROUTE_METHODS.has(callee.name.text)) return undefined;
	const [routePath] = node.arguments;
	if (!routePath || !ts.isStringLiteralLike(routePath)) return undefined;
	const foundPageCall = findPageCall(node.arguments.slice(1));
	const pageCall = foundPageCall?.node;
	const definition = foundPageCall?.definition;
	const [input] = pageCall?.arguments ?? [];
	if (!pageCall || !input) {
		return undefined;
	}
	if (!definition) return undefined;
	if (definition.inputKind === 'static') {
		const bundleKey = assetKey(input, checker);
		if (!bundleKey) return undefined;
		const pageId = `${definition.framework}:${bundleKey}`;
		const propsSchemaHash = hashAbsoluteMobilePropsSchema({
			properties: {},
			type: 'object'
		});

		return {
			inputKind: 'static',
			metadata: {
				bundleKey,
				contract: `${definition.framework}:${pageId}:${propsSchemaHash}`,
				framework: definition.framework,
				pageId,
				propsSchemaHash
			},
			pageCallStart: pageCall.getStart(sourceFile),
			routeCallSpan: `${node.getStart(sourceFile)}:${node.end}`
		} satisfies AnalyzedPageCall;
	}
	if (!ts.isObjectLiteralExpression(input) || !definition.bundleProperty) {
		return undefined;
	}
	const page = definition.pageProperty
		? objectPropertyExpression(input, definition.pageProperty)
		: undefined;
	const source = definition.sourceProperty
		? objectAssetKey(input, definition.sourceProperty, checker)
		: undefined;
	if (definition.pageProperty && !page) return undefined;
	if (definition.sourceProperty && !source) return undefined;
	const props = objectPropertyExpression(input, definition.propsProperty);
	const bundleKey = objectAssetKey(input, definition.bundleProperty, checker);
	if (!bundleKey) return undefined;
	const pageId = page
		? resolvePageIdentity(page, sourceFile, checker, projectRoot)
		: `${definition.framework}:${source}`;
	let propsType: ts.Type | undefined;
	if (page) propsType = pagePropsType(page, props, checker);
	else if (props) propsType = checker.getTypeAtLocation(props);
	const schema = propsType
		? serializeType(propsType, checker)
		: { properties: {}, type: 'object' };
	const propsSchemaHash = hashAbsoluteMobilePropsSchema(schema);
	const metadata: AbsoluteMobileBuildPageMetadata = {
		bundleKey,
		contract: `${definition.framework}:${pageId}:${propsSchemaHash}`,
		framework: definition.framework,
		pageId,
		propsSchemaHash
	};
	const result: AnalyzedPageCall = {
		inputKind: 'object',
		metadata,
		pageCallStart: pageCall.getStart(sourceFile),
		routeCallSpan: `${node.getStart(sourceFile)}:${node.end}`
	};

	return result;
};

const analyzeSourceFile = (
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	projectRoot: string
) => {
	const analysis: AnalyzedFile = {
		byPageCall: new Map(),
		byRouteCall: new Map()
	};
	const visit = (node: ts.Node) => {
		const result = ts.isCallExpression(node)
			? analyzeRouteCall(node, sourceFile, checker, projectRoot)
			: undefined;
		if (result) {
			analysis.byPageCall.set(result.pageCallStart, result);
			analysis.byRouteCall.set(result.routeCallSpan, result);
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);

	return analysis;
};

const analyzeProgram = (program: ts.Program, projectRoot: string) => {
	const checker = program.getTypeChecker();
	const analyzed = new Map<string, AnalyzedFile>();
	for (const sourceFile of program.getSourceFiles()) {
		const resolvedFile = resolve(sourceFile.fileName);
		if (!isProjectSource(sourceFile, resolvedFile, projectRoot)) continue;
		const analysis = analyzeSourceFile(sourceFile, checker, projectRoot);
		if (analysis.byPageCall.size > 0) analyzed.set(resolvedFile, analysis);
	}

	return analyzed;
};

const metadataExpression = (metadata: AbsoluteMobileBuildPageMetadata) =>
	ts.factory.createObjectLiteralExpression(
		Object.entries(metadata).map(([key, item]) =>
			ts.factory.createPropertyAssignment(
				ts.factory.createStringLiteral(key),
				ts.factory.createStringLiteral(item)
			)
		),
		false
	);

const routeOptions = (
	existing: ts.Expression | undefined,
	metadata: AbsoluteMobileBuildPageMetadata
) => {
	const detail = ts.factory.createObjectLiteralExpression([
		ts.factory.createPropertyAssignment(
			ts.factory.createStringLiteral(ABSOLUTE_MOBILE_ROUTE_DETAIL),
			metadataExpression(metadata)
		)
	]);
	if (!existing) {
		return ts.factory.createObjectLiteralExpression([
			ts.factory.createPropertyAssignment('detail', detail)
		]);
	}

	return ts.factory.createObjectLiteralExpression([
		ts.factory.createSpreadAssignment(existing),
		ts.factory.createPropertyAssignment(
			'detail',
			ts.factory.createObjectLiteralExpression([
				ts.factory.createSpreadAssignment(
					ts.factory.createPropertyAccessExpression(
						existing,
						'detail'
					)
				),
				ts.factory.createPropertyAssignment(
					ts.factory.createStringLiteral(
						ABSOLUTE_MOBILE_ROUTE_DETAIL
					),
					metadataExpression(metadata)
				)
			])
		)
	]);
};

const transformPageCall = (
	node: ts.CallExpression,
	page: AnalyzedPageCall | undefined
) => {
	if (!page) return undefined;
	if (page.inputKind === 'static') {
		const [pagePath, existingOptions, ...rest] = node.arguments;
		if (!pagePath) return undefined;
		const options = ts.factory.createObjectLiteralExpression([
			...(existingOptions
				? [ts.factory.createSpreadAssignment(existingOptions)]
				: []),
			ts.factory.createPropertyAssignment(
				'__absoluteMobile',
				metadataExpression(page.metadata)
			)
		]);

		return ts.factory.updateCallExpression(
			node,
			node.expression,
			node.typeArguments,
			[pagePath, options, ...rest]
		);
	}
	const [input] = node.arguments;
	if (!input || !ts.isObjectLiteralExpression(input)) return undefined;

	return ts.factory.updateCallExpression(
		node,
		node.expression,
		node.typeArguments,
		[
			ts.factory.updateObjectLiteralExpression(input, [
				...input.properties,
				ts.factory.createPropertyAssignment(
					'__absoluteMobile',
					metadataExpression(page.metadata)
				)
			]),
			...node.arguments.slice(1)
		]
	);
};

const transformRouteCall = (
	node: ts.CallExpression,
	route: AnalyzedPageCall | undefined
) => {
	if (!route) return undefined;
	const [path, maybeOptions, maybeHandler, ...rest] = node.arguments;
	if (!path || !maybeOptions) return undefined;
	const options = maybeHandler ? maybeOptions : undefined;
	const handler = maybeHandler ?? maybeOptions;

	return ts.factory.updateCallExpression(
		node,
		node.expression,
		node.typeArguments,
		[path, routeOptions(options, route.metadata), handler, ...rest]
	);
};

const transformFile = (
	source: string,
	fileName: string,
	analysis: AnalyzedFile
) => {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);
	const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
		const visit: ts.Visitor = (node) => {
			if (!ts.isCallExpression(node)) {
				return ts.visitEachChild(node, visit, context);
			}
			const transformedChildren = ts.visitEachChild(node, visit, context);
			const page = analysis.byPageCall.get(node.getStart(sourceFile));
			const transformedPage = transformPageCall(
				transformedChildren,
				page
			);
			if (transformedPage) return transformedPage;
			const route = analysis.byRouteCall.get(
				`${node.getStart(sourceFile)}:${node.end}`
			);
			const transformedRoute = transformRouteCall(
				transformedChildren,
				route
			);
			if (transformedRoute) return transformedRoute;

			return transformedChildren;
		};

		return (node) => ts.visitNode(node, visit, ts.isSourceFile) ?? node;
	};
	const result = ts.transform(sourceFile, [transformer]);
	try {
		const [transformed] = result.transformed;
		if (!transformed) throw new TypeError('Mobile route transform failed.');

		return ts.createPrinter().printFile(transformed);
	} finally {
		result.dispose();
	}
};

export const ABSOLUTE_MOBILE_TRANSFORM_PROTOCOL =
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION;
export const createAbsoluteMobileRouteMetadataPlugin = (
	options: MobileRouteTransformOptions
): BunPlugin => {
	const projectRoot = resolve(options.projectRoot ?? process.cwd());
	const entry = resolve(options.entry);
	const analyzed = analyzeProgram(
		createProgram(entry, projectRoot),
		projectRoot
	);

	return {
		name: 'absolute-mobile-route-metadata',
		setup(build) {
			build.onLoad({ filter: SOURCE_FILTER }, async ({ path }) => {
				const analysis = analyzed.get(resolve(path));
				if (!analysis) return undefined;
				const source = await Bun.file(path).text();

				return {
					contents: transformFile(source, path, analysis),
					loader: extname(path).endsWith('x') ? 'tsx' : 'ts'
				};
			});
		}
	};
};
export const inspectAbsoluteMobileRouteMetadata = (
	options: MobileRouteTransformOptions
) => {
	const projectRoot = resolve(options.projectRoot ?? process.cwd());
	const entry = resolve(options.entry);
	const analyzed = analyzeProgram(
		createProgram(entry, projectRoot),
		projectRoot
	);

	return [...analyzed.entries()].flatMap(([file, analysis]) =>
		[...analysis.byRouteCall.values()].map(({ metadata }) => ({
			file: posixPath(relative(projectRoot, file)),
			metadata
		}))
	);
};
