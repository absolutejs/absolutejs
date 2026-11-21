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
		if (ROUTER_PACKAGES.has(specifier)) {
			if (named && ts.isNamedImports(named))
				for (const element of named.elements)
					if ((element.propertyName ?? element.name).text === 'Route')
						routeNames.add(element.name.text);
			continue;
		}
		if (!isLocalSpecifier(specifier)) continue;
		if (clause.name)
			bindings.set(clause.name.text, {
				declaration: statement,
				imported: 'default',
				local: clause.name.text,
				specifier
			});
		if (named && ts.isNamedImports(named))
			for (const element of named.elements) {
				if (element.isTypeOnly) continue;
				bindings.set(element.name.text, {
					declaration: statement,
					imported: (element.propertyName ?? element.name).text,
					local: element.name.text,
					specifier
				});
			}
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

/* The component a route renders, and every tag naming it (an element
 * written with a closing tag names it twice). */
const elementComponent = (opening: TS.JsxOpeningLikeElement) => {
	for (const attribute of opening.attributes.properties) {
		if (!ts.isJsxAttribute(attribute)) continue;
		if (!ts.isIdentifier(attribute.name)) continue;
		if (attribute.name.text !== 'element') continue;
		const value = attribute.initializer;
		if (!value || !ts.isJsxExpression(value) || !value.expression)
			return null;
		const element = value.expression;
		if (ts.isJsxSelfClosingElement(element))
			return { opening: element, tags: [element.tagName] };
		if (ts.isJsxElement(element))
			return {
				opening: element.openingElement,
				tags: [
					element.openingElement.tagName,
					element.closingElement.tagName
				]
			};

		return null;
	}

	return null;
};

/* The tag-name identifiers of every route page element, and the names of
 * the components used that way. */
const findRoutePages = (file: TS.SourceFile, routeNames: Set<string>) => {
	const pageTags = new Set<TS.Node>();
	const pageNames = new Set<string>();
	const visit = (node: TS.Node) => {
		const opening = ts.isJsxElement(node)
			? node.openingElement
			: ts.isJsxSelfClosingElement(node)
				? node
				: null;
		const name = opening && tagName(opening);
		if (
			opening &&
			name !== null &&
			routeNames.has(name) &&
			isLeafRoute(node)
		) {
			const page = elementComponent(opening);
			const pageName = page && tagName(page.opening);
			if (page && pageName !== null) {
				for (const tag of page.tags) pageTags.add(tag);
				pageNames.add(pageName);
			}
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
		end = statement.end;
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
		(a, b) => b.getStart() - a.getStart()
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
		output.slice(0, insertAt) +
		prologueGap +
		`import { lazyRoute as ${LAZY_IMPORT} } from ${JSON.stringify(LAZY_SOURCE)};\n` +
		`${definitions.join('\n')}\n` +
		output.slice(insertAt)
	);
};
