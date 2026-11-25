/** Extract SPA child routes from a Vue page's module-level script.
 *
 *  The result drives the per-route CSS side manifest emitted in
 *  `core/build.ts`. Parse the supported `defineRoutes([...])` shape with the
 *  TypeScript AST so redirect-only entries cannot accidentally consume the
 *  dynamic import from the following route.
 */
import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

export type ParsedVueSpaRoute = {
	path: string;
	importPath: string;
};

const propertyName = (node: TS.PropertyName) =>
	ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null;

const stringValue = (node: TS.Expression) =>
	ts.isStringLiteralLike(node) ? node.text : null;

const findVueImport = (node: TS.Node): string | null => {
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

/* The lazy `.vue` imports a route renders: its `component`, or each named
 * view of `components: { default, sidebar }`. */
const routeImports = (node: TS.ObjectLiteralExpression) =>
	node.properties.flatMap((property) => {
		if (!ts.isPropertyAssignment(property)) return [];
		const name = propertyName(property.name);
		if (name === 'component') {
			const found = findVueImport(property.initializer);

			return found ? [found] : [];
		}
		if (
			name !== 'components' ||
			!ts.isObjectLiteralExpression(property.initializer)
		)
			return [];

		return property.initializer.properties.flatMap((view) => {
			const found = ts.isPropertyAssignment(view)
				? findVueImport(view.initializer)
				: null;

			return found ? [found] : [];
		});
	});

const parseRoute = (node: TS.Expression) => {
	if (!ts.isObjectLiteralExpression(node)) return [];
	const pathProperty = node.properties.find(
		(property): property is TS.PropertyAssignment =>
			ts.isPropertyAssignment(property) &&
			propertyName(property.name) === 'path'
	);
	const path = pathProperty ? stringValue(pathProperty.initializer) : null;
	// An empty path is a layout's default child, a real route.
	if (path === null) return [];

	return routeImports(node).map((importPath) => ({ importPath, path }));
};

/* A child route's path under its parent's: absolute paths stand as they
 * are, relative ones join the parent's. */
const joinRoutePath = (parent: string, path: string) => {
	if (path.startsWith('/') || parent === '') return path;
	if (path === '') return parent;

	return `${parent.replace(/\/$/, '')}/${path}`;
};

/* Routes at every depth: a lazy page under a layout route needs its own
 * compile entry and CSS like a top-level one. */
const collectRoutes = (
	routes: TS.ArrayLiteralExpression,
	parentPath: string,
	entries: ParsedVueSpaRoute[]
) => {
	for (const element of routes.elements) {
		if (!ts.isObjectLiteralExpression(element)) continue;
		const parsed = parseRoute(element);
		const ownPath = element.properties.find(
			(property): property is TS.PropertyAssignment =>
				ts.isPropertyAssignment(property) &&
				propertyName(property.name) === 'path'
		);
		const pathText = ownPath ? stringValue(ownPath.initializer) : null;
		const fullPath =
			pathText === null
				? parentPath
				: joinRoutePath(parentPath, pathText);
		for (const route of parsed)
			entries.push({
				...route,
				path: joinRoutePath(parentPath, route.path)
			});
		const children = element.properties.find(
			(property): property is TS.PropertyAssignment =>
				ts.isPropertyAssignment(property) &&
				propertyName(property.name) === 'children'
		);
		if (children && ts.isArrayLiteralExpression(children.initializer))
			collectRoutes(children.initializer, fullPath, entries);
	}
};

export const parseVueSpaRoutes = (source: string) => {
	const sourceFile = ts.createSourceFile(
		'absolute-vue-routes.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const entries: ParsedVueSpaRoute[] = [];

	const visit = (node: TS.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineRoutes'
		) {
			const [routes] = node.arguments;
			if (routes && ts.isArrayLiteralExpression(routes))
				collectRoutes(routes, '', entries);
		}
		ts.forEachChild(node, visit);
	};

	ts.forEachChild(sourceFile, visit);

	return entries;
};
