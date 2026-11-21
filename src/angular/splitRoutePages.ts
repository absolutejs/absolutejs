import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

/* Pages placed in an Angular SPA's router load their code the first time
 * they are shown, with nothing for the app to write: the Angular
 * counterpart of build/splitRoutePages.ts.
 *
 *   import { BillingComponent } from '../components/billing/billing';
 *   export const routes: Routes = [{ component: BillingComponent, path: 'billing' }];
 *
 * becomes, before either the server or the browser compile sees the file,
 *
 *   export const routes: Routes = [
 *     { loadComponent: () => import("../components/billing/billing").then((m) => m.BillingComponent), path: 'billing' }
 *   ];
 *
 * which Angular's router loads lazily; the server render waits for the
 * route to resolve, and the browser's first navigation is blocking
 * (compileAngular.ts injects withEnabledBlockingInitialNavigation), so
 * hydration finds the component in place.
 *
 * Split: a leaf route's `component`, a named import from a local file,
 * used nowhere else in the file (a component also listed in a
 * `@Component({ imports })` stays eager). A layout route (one with
 * `children`) keeps its component; its children are split. */

const isLocalSpecifier = (specifier: string) =>
	specifier.startsWith('./') || specifier.startsWith('../');

type Binding = {
	declaration: TS.ImportDeclaration;
	imported: string;
	specifier: string;
};

/* A local import's named value bindings, as [local name, binding]. */
const importBindings = (statement: TS.Statement) => {
	const none: [string, Binding][] = [];
	if (!ts.isImportDeclaration(statement)) return none;
	const clause = statement.importClause;
	if (!clause || clause.isTypeOnly) return none;
	if (!ts.isStringLiteral(statement.moduleSpecifier)) return none;
	const specifier = statement.moduleSpecifier.text;
	if (!isLocalSpecifier(specifier)) return none;
	const named = clause.namedBindings;
	if (!named || !ts.isNamedImports(named)) return none;

	return named.elements
		.filter((element) => !element.isTypeOnly)
		.map(
			(element) =>
				[
					element.name.text,
					{
						declaration: statement,
						imported: (element.propertyName ?? element.name).text,
						specifier
					}
				] satisfies [string, Binding]
		);
};

const readBindings = (file: TS.SourceFile) =>
	new Map(file.statements.flatMap(importBindings));

const unwrap = (expression: TS.Expression): TS.Expression =>
	ts.isAsExpression(expression) ||
	ts.isSatisfiesExpression(expression) ||
	ts.isParenthesizedExpression(expression)
		? unwrap(expression.expression)
		: expression;

const propertyNamed = (node: TS.ObjectLiteralExpression, name: string) =>
	node.properties.find(
		(property): property is TS.PropertyAssignment =>
			ts.isPropertyAssignment(property) &&
			(ts.isIdentifier(property.name) ||
				ts.isStringLiteral(property.name)) &&
			property.name.text === name
	);

const ROUTER_CALLS = new Set(['provideRouter', 'forRoot', 'forChild']);

const calleeName = (callee: TS.Expression) => {
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;

	return '';
};

/* The routes array passed to provideRouter / forRoot / forChild, if any. */
const routerCallRoutes = (node: TS.CallExpression) => {
	const [first] = node.arguments;
	if (!ROUTER_CALLS.has(calleeName(node.expression)) || !first) return null;
	const value = unwrap(first);

	return ts.isArrayLiteralExpression(value) ? value : null;
};

/* The route arrays a file declares: a `routes`/`Routes`-typed variable, or
 * the first argument of provideRouter / RouterModule.forRoot / forChild. */
const routeArrays = (file: TS.SourceFile) => {
	const arrays: TS.ArrayLiteralExpression[] = [];
	const visit = (node: TS.Node) => {
		if (ts.isVariableDeclaration(node) && node.initializer) {
			const typed =
				node.type !== undefined &&
				ts.isTypeReferenceNode(node.type) &&
				ts.isIdentifier(node.type.typeName) &&
				node.type.typeName.text === 'Routes';
			const named =
				ts.isIdentifier(node.name) && node.name.text === 'routes';
			const value = unwrap(node.initializer);
			if ((typed || named) && ts.isArrayLiteralExpression(value))
				arrays.push(value);
		}
		const passed = ts.isCallExpression(node)
			? routerCallRoutes(node)
			: null;
		if (passed) arrays.push(passed);
		ts.forEachChild(node, visit);
	};
	visit(file);

	return [...new Set(arrays)];
};

/* Every leaf route's `component: X` property, through nested children. */
const leafComponents = (routes: TS.ArrayLiteralExpression) => {
	const found: TS.PropertyAssignment[] = [];
	const visitRoutes = (array: TS.ArrayLiteralExpression) => {
		for (const element of array.elements) {
			if (!ts.isObjectLiteralExpression(element)) continue;
			const children = propertyNamed(element, 'children');
			const nested = children ? unwrap(children.initializer) : null;
			if (nested && ts.isArrayLiteralExpression(nested))
				visitRoutes(nested);
			if (children) continue;
			const component = propertyNamed(element, 'component');
			if (component && ts.isIdentifier(component.initializer))
				found.push(component);
		}
	};
	visitRoutes(routes);

	return found;
};

/* The import without the bindings that became lazy, or '' when nothing
 * is left. */
const rewriteImport = (
	declaration: TS.ImportDeclaration,
	removed: Set<string>
) => {
	const clause = declaration.importClause;
	const named = clause?.namedBindings;
	if (!clause || !named || !ts.isNamedImports(named))
		return declaration.getText();
	const kept = named.elements
		.filter((element) => !removed.has(element.name.text))
		.map((element) => element.getText());
	const parts = [
		...(clause.name ? [clause.name.text] : []),
		...(kept.length > 0 ? [`{ ${kept.join(', ')} }`] : [])
	];
	if (parts.length === 0) return '';

	return `import ${parts.join(', ')} from ${declaration.moduleSpecifier.getText()};`;
};

/** The file with its router pages loading lazily, or null when nothing in
 *  it changes. */
export const splitAngularRoutePages = (source: string, fileName: string) => {
	if (!source.includes('component') || !source.includes('@angular/router'))
		return null;
	const file = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const bindings = readBindings(file);
	if (bindings.size === 0) return null;
	const uses = [...new Set(routeArrays(file).flatMap(leafComponents))].filter(
		(property) =>
			ts.isIdentifier(property.initializer) &&
			bindings.has(property.initializer.text)
	);
	if (uses.length === 0) return null;

	const lazy = new Set<string>();
	for (const name of new Set(
		uses.map((property) => property.initializer.getText())
	)) {
		const binding = bindings.get(name);
		if (!binding) continue;
		const declarationText = binding.declaration.getText();
		const pattern = new RegExp(`\\b${name}\\b`, 'g');
		const everywhere = source.match(pattern)?.length ?? 0;
		const inImport = declarationText.match(pattern)?.length ?? 0;
		const asRoutes = uses.filter(
			(property) => property.initializer.getText() === name
		).length;
		if (everywhere - inImport === asRoutes) lazy.add(name);
	}
	if (lazy.size === 0) return null;

	const edits: [number, number, string][] = [];
	for (const property of uses) {
		const name = property.initializer.getText();
		const binding = bindings.get(name);
		if (!binding || !lazy.has(name)) continue;
		edits.push([
			property.getStart(),
			property.end,
			`loadComponent: () => import(${JSON.stringify(binding.specifier)}).then((m) => m.${binding.imported})`
		]);
	}
	for (const declaration of new Set(
		[...lazy].flatMap((name) => {
			const binding = bindings.get(name);

			return binding ? [binding.declaration] : [];
		})
	))
		edits.push([
			declaration.getStart(),
			declaration.end,
			rewriteImport(declaration, lazy)
		]);

	return edits
		.sort((left, right) => right[0] - left[0])
		.reduce(
			(output, [start, end, text]) =>
				output.slice(0, start) + text + output.slice(end),
			source
		);
};
