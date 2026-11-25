import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

/* Pages placed in a React router load their code the first time they are
 * shown, with nothing for the app to write.
 *
 *   import { Billing } from './Billing';
 *   <Route element={<Billing />} path="/billing" />
 *
 * becomes, in every build of the file (dev and production, browser and
 * server alike, so both render the same Suspense boundaries):
 *
 *   const Billing = __absoluteLazyRoute(() => import('./Billing'), 'Billing');
 *
 * so the page is its own chunk: the app's entry no longer carries every
 * page, the layout hydrates while a page's code is still on its way, and a
 * page loaded once opens at once after (react/router/lazyRoute.ts).
 *
 * What is split: a component imported from the app's own code (a relative
 * or absolute path, not a package) and used in the file only as the
 * element of a leaf `<Route>` from react-router. A layout route (one with
 * child routes) stays in the entry: it is the part of the page that should
 * respond at once. A component the file also uses anywhere else stays
 * eager too: splitting it would load it twice. */

const ROUTER_PACKAGES = new Set(['react-router', 'react-router-dom']);
const LAZY_IMPORT = '__absoluteLazyRoute';
const LAZY_SOURCE = '@absolutejs/absolute/react/router';

/** A cheap pre-check: files that never mention a Route skip the parse. */
const mayHaveRoutes = (source: string) =>
	source.includes('<Route') && source.includes('react-router');

const isLocalSpecifier = (specifier: string) =>
	specifier.startsWith('./') ||
	specifier.startsWith('../') ||
	specifier.startsWith('/');

type Binding = {
	declaration: TS.ImportDeclaration;
	imported: string;
	local: string;
	specifier: string;
};

const readBindings = (file: TS.SourceFile) => {
	const bindings = new Map<string, Binding>();
	const routeNames = new Set<string>();
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const clause = statement.importClause;
		if (!clause || clause.isTypeOnly) continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		const named = clause.namedBindings;
		const namedElements =
			named && ts.isNamedImports(named) ? [...named.elements] : [];
		const fromRouter = ROUTER_PACKAGES.has(specifier);
		if (fromRouter)
			namedElements
				.filter(
					(element) =>
						(element.propertyName ?? element.name).text === 'Route'
				)
				.forEach((element) => routeNames.add(element.name.text));
		if (fromRouter) continue;
		if (!isLocalSpecifier(specifier)) continue;
		if (clause.name)
			bindings.set(clause.name.text, {
				declaration: statement,
				imported: 'default',
				local: clause.name.text,
				specifier
			});
		namedElements
			.filter((element) => !element.isTypeOnly)
			.forEach((element) =>
				bindings.set(element.name.text, {
					declaration: statement,
					imported: (element.propertyName ?? element.name).text,
					local: element.name.text,
					specifier
				})
			);
	}

	return { bindings, routeNames };
};

const tagName = (node: TS.JsxOpeningLikeElement) =>
	ts.isIdentifier(node.tagName) ? node.tagName.text : null;

/* A `<Route>` with no child elements: a page, not a layout. */
const isLeafRoute = (node: TS.Node) => {
	if (ts.isJsxSelfClosingElement(node)) return true;
	if (!ts.isJsxElement(node)) return false;

	return node.children.every(
		(child) => ts.isJsxText(child) && child.text.trim() === ''
	);
};

/* The route's `element` expression, if it has one. */
const elementExpression = (opening: TS.JsxOpeningLikeElement) => {
	for (const attribute of opening.attributes.properties) {
		if (!ts.isJsxAttribute(attribute)) continue;
		if (!ts.isIdentifier(attribute.name)) continue;
		if (attribute.name.text !== 'element') continue;
		const value = attribute.initializer;

		return value && ts.isJsxExpression(value)
			? (value.expression ?? null)
			: null;
	}

	return null;
};

const hasContent = (element: TS.JsxElement) =>
	element.children.some(
		(child) => !(ts.isJsxText(child) && child.text.trim() === '')
	);

type RoutePage = { name: string; tags: TS.Node[] };

/* The pages inside a route's element: every component in it that wraps no
 * content of its own. A wrapper (an auth guard, an error boundary, a page
 * frame like `<AdminPage title="Today">`) stays in the entry, so it renders
 * at once; what it wraps is the page. `element={<Billing />}` is the case
 * with no wrapper. */
const elementPages = (expression: TS.Expression) => {
	const pages: RoutePage[] = [];
	const visit = (node: TS.Node) => {
		if (ts.isJsxSelfClosingElement(node)) {
			const name = tagName(node);
			if (name !== null) pages.push({ name, tags: [node.tagName] });
		}
		if (ts.isJsxElement(node) && !hasContent(node)) {
			const name = tagName(node.openingElement);
			if (name !== null)
				pages.push({
					name,
					tags: [
						node.openingElement.tagName,
						node.closingElement.tagName
					]
				});
		}
		ts.forEachChild(node, visit);
	};
	visit(expression);

	return pages;
};

const unwrapParentheses = (expression: TS.Expression): TS.Expression =>
	ts.isParenthesizedExpression(expression)
		? unwrapParentheses(expression.expression)
		: expression;

const isJsx = (expression: TS.Expression) =>
	ts.isJsxElement(expression) ||
	ts.isJsxSelfClosingElement(expression) ||
	ts.isJsxFragment(expression);

/* `const ordersPage = (<AdminPage><OrdersView /></AdminPage>);` — an element
 * named once and reused by several routes. Only a name declared exactly
 * once in the file, as a const holding JSX, is followed. */
const jsxConstants = (file: TS.SourceFile) => {
	const found = new Map<string, TS.Expression | null>();
	const visit = (node: TS.Node) => {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer
		) {
			const value = unwrapParentheses(node.initializer);
			const isConst =
				ts.isVariableDeclarationList(node.parent) &&
				(node.parent.flags & ts.NodeFlags.Const) !== 0;
			const name = node.name.text;
			found.set(
				name,
				!found.has(name) && isConst && isJsx(value) ? value : null
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);

	return found;
};

/* The JSX a route's element stands for: written inline, or through a
 * const that holds it. */
const resolveElement = (
	expression: TS.Expression,
	constants: Map<string, TS.Expression | null>
) =>
	ts.isIdentifier(expression)
		? (constants.get(expression.text) ?? null)
		: expression;

/* The tag-name identifiers of every route page element, and the names of
 * the components used that way. */
const findRoutePages = (file: TS.SourceFile, routeNames: Set<string>) => {
	const pageTags = new Set<TS.Node>();
	const pageNames = new Set<string>();
	const constants = jsxConstants(file);
	const visit = (node: TS.Node) => {
		const selfClosing = ts.isJsxSelfClosingElement(node) ? node : null;
		const opening = ts.isJsxElement(node)
			? node.openingElement
			: selfClosing;
		const name = opening && tagName(opening);
		if (
			opening &&
			name !== null &&
			routeNames.has(name) &&
			isLeafRoute(node)
		) {
			const written = elementExpression(opening);
			const expression = written && resolveElement(written, constants);
			const pages = expression ? elementPages(expression) : [];
			pages.forEach((page) => {
				for (const tag of page.tags) pageTags.add(tag);
				pageNames.add(page.name);
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(file);

	return { pageNames, pageTags };
};

/* Names used anywhere other than as a route page's tag (or their own
 * import): those stay eager. */
const usedElsewhere = (
	file: TS.SourceFile,
	names: Set<string>,
	pageTags: Set<TS.Node>
) => {
	const elsewhere = new Set<string>();
	const visit = (node: TS.Node) => {
		if (ts.isImportDeclaration(node)) return;
		if (
			ts.isIdentifier(node) &&
			names.has(node.text) &&
			!pageTags.has(node)
		)
			elsewhere.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(file);

	return elsewhere;
};

/* The import declaration without the bindings that became lazy: rewritten
 * from what is left, or removed when nothing is. */
const rewriteImport = (
	declaration: TS.ImportDeclaration,
	removed: Set<string>,
	source: string
) => {
	const clause = declaration.importClause;
	if (!clause) return source.slice(declaration.getStart(), declaration.end);
	const keepDefault =
		clause.name && !removed.has(clause.name.text) ? clause.name.text : null;
	const named = clause.namedBindings;
	const namespace =
		named && ts.isNamespaceImport(named) ? `* as ${named.name.text}` : null;
	const kept =
		named && ts.isNamedImports(named)
			? named.elements
					.filter((element) => !removed.has(element.name.text))
					.map((element) => element.getText())
			: [];
	const parts = [
		...(keepDefault ? [keepDefault] : []),
		...(namespace ? [namespace] : []),
		...(kept.length > 0 ? [`{ ${kept.join(', ')} }`] : [])
	];
	if (parts.length === 0) return '';

	return `import ${parts.join(', ')} from ${declaration.moduleSpecifier.getText()};`;
};

/* Where the file's leading string directives end ('use client'). The
 * import rewrites all come after them, so the offset holds in the output. */
const directivePrologueEnd = (file: TS.SourceFile) => {
	let end = 0;
	for (const statement of file.statements) {
		if (
			!ts.isExpressionStatement(statement) ||
			!ts.isStringLiteral(statement.expression)
		)
			break;
		({ end } = statement);
	}

	return end;
};

/**
 * The file with its route pages loading lazily, or null when nothing in it
 * changes (no router, no leaf route whose page is a local import).
 */
export const splitRoutePages = (source: string, fileName: string) => {
	if (!mayHaveRoutes(source)) return null;
	const file = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	);
	const { bindings, routeNames } = readBindings(file);
	if (routeNames.size === 0) return null;
	const { pageNames, pageTags } = findRoutePages(file, routeNames);
	const candidates = new Set(
		[...pageNames].filter((name) => bindings.has(name))
	);
	if (candidates.size === 0) return null;
	const elsewhere = usedElsewhere(file, candidates, pageTags);
	const lazy = [...candidates]
		.filter((name) => !elsewhere.has(name))
		.flatMap((name) => {
			const binding = bindings.get(name);

			return binding ? [binding] : [];
		});
	if (lazy.length === 0) return null;

	const removed = new Set(lazy.map((binding) => binding.local));
	const declarations = [
		...new Set(lazy.map((binding) => binding.declaration))
	];
	// Rewrite from the end so earlier positions stay valid.
	const ordered = [...declarations].sort(
		(left, right) => right.getStart() - left.getStart()
	);
	let output = source;
	for (const declaration of ordered)
		output =
			output.slice(0, declaration.getStart()) +
			rewriteImport(declaration, removed, source) +
			output.slice(declaration.end);

	const definitions = lazy.map(
		(binding) =>
			`const ${binding.local} = ${LAZY_IMPORT}(() => import(${JSON.stringify(binding.specifier)}), ${JSON.stringify(binding.imported)});`
	);
	// At the top: imports are hoisted, so the definitions can precede the
	// file's other imports (they use none of them). Only a directive
	// prologue ('use client') must stay first.
	const insertAt = directivePrologueEnd(file);
	const prologueGap = insertAt > 0 ? '\n' : '';

	return (
		`${
			output.slice(0, insertAt) + prologueGap
		}import { lazyRoute as ${LAZY_IMPORT} } from ${JSON.stringify(LAZY_SOURCE)};\n` +
		`${definitions.join('\n')}\n${output.slice(insertAt)}`
	);
};
