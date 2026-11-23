import ts from 'typescript';

export type MigrationDiagnostic = {
	code: string;
	file: string;
	line: number;
	message: string;
	edit?: { start: number; end: number; text: string };
};

const ON_ERROR_SCOPES = new Set(['global', 'local', 'plugin']);

// Names that changed on the way to Elysia 2.0.0-rc.0: the lifecycle hooks
// carry an on prefix again (setup/cleanup became onStart/onStop), while
// mapResponse, trace and derive stay bare.
const renamed = new Map([
	['request', 'onRequest'],
	['parse', 'onParse'],
	['transform', 'onTransform'],
	['beforeHandle', 'onBeforeHandle'],
	['afterHandle', 'onAfterHandle'],
	['afterResponse', 'onAfterResponse'],
	['error', 'onError'],
	['setup', 'onStart'],
	['cleanup', 'onStop'],
	['onMapResponse', 'mapResponse'],
	['onTrace', 'trace'],
	['resolve', 'derive'],
	['mapResolve', 'mapDerive']
]);
const routes = new Set([
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'head',
	'options',
	'all',
	'ws'
]);

/** Conservative syntactic check: only locally traceable Elysia instances, never similarly named client APIs. */
export const checkElysia2Source = (file: string, content: string) => {
	if (!content.includes('elysia') || !/\.[cm]?[jt]sx?$/.test(file)) return [];
	const source = ts.createSourceFile(
		file,
		content,
		ts.ScriptTarget.Latest,
		true
	);
	const errors: MigrationDiagnostic[] = [];
	// Bind names without resolving dependencies: parameters/local variables can shadow an imported constructor or app.
	const host: ts.CompilerHost = {
		fileExists: (name) => name === file,
		getCanonicalFileName: (name) => name,
		getCurrentDirectory: () => '',
		getDefaultLibFileName: () => '',
		getDirectories: () => [],
		getNewLine: () => '\n',
		getSourceFile: (name) => (name === file ? source : undefined),
		readFile: (name) => (name === file ? content : undefined),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => undefined
	};
	const checker = ts
		.createProgram([file], { noLib: true, noResolve: true }, host)
		.getTypeChecker();
	const constructors = new Set<ts.Node>();
	const namespaces = new Set<ts.Node>();
	const report = (
		node: ts.Node,
		message: string,
		edit?: MigrationDiagnostic['edit']
	) =>
		errors.push({
			code: 'elysia-2',
			...(edit ? { edit } : {}),
			file,
			line:
				source.getLineAndCharacterOfPosition(
					(ts.isCallExpression(node) &&
					ts.isPropertyAccessExpression(node.expression)
						? node.expression.name
						: node
					).getStart(source)
				).line + 1,
			message: `Elysia 2: ${message}`
		});
	for (const node of source.statements) {
		if (
			!ts.isImportDeclaration(node) ||
			!ts.isStringLiteral(node.moduleSpecifier)
		)
			continue;
		const name = node.moduleSpecifier.text;
		if (name.startsWith('@elysiajs/'))
			report(
				node,
				'Check the Elysia 2 replacement for this legacy plugin package.'
			);
		if (name !== 'elysia') continue;
		const clause = node.importClause;
		if (clause?.name) constructors.add(clause);
		const bindings = clause?.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings))
			namespaces.add(bindings);
		if (bindings && ts.isNamedImports(bindings))
			bindings.elements.forEach((entry) => {
				if ((entry.propertyName ?? entry.name).text === 'Elysia')
					constructors.add(entry);
			});
	}
	const declaration = (node: ts.Identifier) =>
		checker.getSymbolAtLocation(node)?.declarations?.[0];
	const isImported = (node: ts.Identifier, declarations: Set<ts.Node>) => {
		const binding = declaration(node);

		return binding !== undefined && declarations.has(binding);
	};
	const isConstructor = (node: ts.Expression) =>
		(ts.isIdentifier(node) && isImported(node, constructors)) ||
		(ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			isImported(node.expression, namespaces) &&
			node.name.text === 'Elysia');
	const isApp = (node: ts.Expression, seen = new Set<ts.Node>()): boolean => {
		if (ts.isParenthesizedExpression(node))
			return isApp(node.expression, seen);
		if (ts.isNewExpression(node)) return isConstructor(node.expression);
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		)
			return isApp(node.expression.expression, seen);
		if (!ts.isIdentifier(node)) return false;
		const binding = declaration(node);
		if (
			!binding ||
			seen.has(binding) ||
			!ts.isVariableDeclaration(binding) ||
			!binding.initializer
		)
			return false;
		seen.add(binding);

		return isApp(binding.initializer, seen);
	};
	const checkCall = (node: ts.CallExpression, method: string) => {
		const args = node.arguments;
		const replacement = renamed.get(method);
		if (replacement)
			report(
				node,
				`Replace .${method} with .${replacement}; consult installed declarations for its signature.`
			);
		const schemaIndex = method === 'route' ? 2 : 1;
		const schema = args[schemaIndex];
		const last = args[schemaIndex + 1];
		if (
			(routes.has(method) || method === 'route') &&
			args.length === schemaIndex + 2 &&
			((schema &&
				(ts.isArrowFunction(schema) ||
					ts.isFunctionExpression(schema))) ||
				(last && ts.isObjectLiteralExpression(last)))
		) {
			report(
				node,
				'Route schema/hooks precede the handler: .post(path, { body: schema }, handler), or .route(method, path, options, handler).'
			);
		}
		if (method === 'macro' && args.length > 1)
			report(
				node,
				'Use .macro({ name: definition }); the two-argument macro API was removed.'
			);
		// .onError('global', handler) and its siblings set the hook's scope.
		if (
			method === 'onError' &&
			args[0] &&
			ts.isStringLiteral(args[0]) &&
			!ON_ERROR_SCOPES.has(args[0].text)
		)
			report(
				node,
				'Register error classes with .onError(ErrorClass, handler), not named error dictionaries.'
			);
		if (
			method === 'as' &&
			args[0] &&
			ts.isStringLiteral(args[0]) &&
			args[0].text === 'scoped'
		)
			report(node, "Use .as('plugin') instead of .as('scoped').", {
				end: args[0].end - 1,
				start: args[0].getStart(source) + 1,
				text: 'plugin'
			});
		const [first] = args;
		if (
			!first ||
			!ts.isObjectLiteralExpression(first) ||
			!/^(on[A-Z]|derive|decorate|state|mapDerive|trace|mapResponse)/.test(
				method
			)
		)
			return;
		for (const prop of first.properties)
			if (
				ts.isPropertyAssignment(prop) &&
				prop.name.getText(source).replace(/["']/g, '') === 'as'
			)
				report(
					prop,
					'Use a string scope argument in place of { as: ... }.'
				);
	};
	const checkConfig = (config?: ts.Expression) => {
		if (!config || !ts.isObjectLiteralExpression(config)) return;
		for (const prop of config.properties)
			if (
				ts.isPropertyAssignment(prop) &&
				prop.name.getText(source) === 'aot' &&
				prop.initializer.kind === ts.SyntaxKind.FalseKeyword
			)
				report(prop, 'aot: false was removed; do not disable AOT.');
	};
	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			isApp(node.expression.expression)
		)
			checkCall(node, node.expression.name.text);
		if (ts.isNewExpression(node) && isConstructor(node.expression))
			checkConfig(node.arguments?.[0]);
		ts.forEachChild(node, visit);
	};
	visit(source);

	return errors;
};
