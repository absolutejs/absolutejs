/** Extract SPA child routes from a Vue page's module-level script.
 *
 *  The result drives the per-route CSS side manifest emitted in
 *  `core/build.ts`. Parse the supported `defineRoutes([...])` shape with the
 *  TypeScript AST so redirect-only entries cannot accidentally consume the
 *  dynamic import from the following route.
 */
import ts from 'typescript';

export type ParsedVueSpaRoute = {
	path: string;
	importPath: string;
};

const propertyName = (node: ts.PropertyName) =>
	ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null;

const stringValue = (node: ts.Expression) =>
	ts.isStringLiteralLike(node) ? node.text : null;

const findVueImport = (node: ts.Node): string | null => {
	if (
		ts.isCallExpression(node) &&
		node.expression.kind === ts.SyntaxKind.ImportKeyword
	) {
		const [specifier] = node.arguments;
		if (specifier && ts.isStringLiteralLike(specifier)) {
			return specifier.text.endsWith('.vue') ? specifier.text : null;
		}
	}

	let found: string | null = null;
	ts.forEachChild(node, (child) => {
		if (found === null) found = findVueImport(child);
	});

	return found;
};

const parseRoute = (node: ts.Expression): ParsedVueSpaRoute | null => {
	if (!ts.isObjectLiteralExpression(node)) return null;
	let path: string | null = null;
	let importPath: string | null = null;

	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = propertyName(property.name);
		if (name === 'path') path = stringValue(property.initializer);
		if (name === 'component')
			importPath = findVueImport(property.initializer);
	}

	return path && importPath ? { importPath, path } : null;
};

export const parseVueSpaRoutes = (source: string): ParsedVueSpaRoute[] => {
	const sourceFile = ts.createSourceFile(
		'absolute-vue-routes.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const entries: ParsedVueSpaRoute[] = [];

	const visit = (node: ts.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineRoutes'
		) {
			const [routes] = node.arguments;
			if (routes && ts.isArrayLiteralExpression(routes)) {
				for (const element of routes.elements) {
					const route = parseRoute(element);
					if (route) entries.push(route);
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	return entries;
};
