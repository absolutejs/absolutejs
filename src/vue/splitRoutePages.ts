import type TS from 'typescript';
import { ts } from '../utils/lazyTypescript';

/* Pages placed in a Vue SPA's router load their code the first time they
 * are shown, with nothing for the app to write: the Vue counterpart of
 * build/splitRoutePages.ts.
 *
 *   import Billing from '../components/Billing.vue';
 *   export const routes = defineRoutes([{ component: Billing, path: '/billing' }]);
 *
 * becomes, in the page's module script, before either the server or the
 * browser module is compiled,
 *
 *   export const routes = defineRoutes([
 *     { component: () => import("../components/Billing.vue"), path: '/billing' }
 *   ]);
 *
 * which vue-router loads lazily and the framework already resolves before
 * both the server render and hydration (vueAutoRouterTransform.ts awaits
 * `router.isReady()` on both sides).
 *
 * Split: a leaf route's `component`, imported by default from a local `.vue`
 * file and used nowhere else in the page. A layout route (one with
 * `children`) keeps its component in the page; its children are split. */

const LOCAL_VUE = /^\.{1,2}\/.*\.vue$/;

type Candidate = { declaration: TS.ImportDeclaration; specifier: string };

const readCandidates = (file: TS.SourceFile) => {
	const candidates = new Map<string, Candidate>();
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement)) continue;
		const clause = statement.importClause;
		if (
			!clause ||
			clause.isTypeOnly ||
			!clause.name ||
			clause.namedBindings
		)
			continue;
		if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const specifier = statement.moduleSpecifier.text;
		if (!LOCAL_VUE.test(specifier)) continue;
		candidates.set(clause.name.text, { declaration: statement, specifier });
	}

	return candidates;
};

const propertyNamed = (node: TS.ObjectLiteralExpression, name: string) =>
	node.properties.find(
		(property): property is TS.PropertyAssignment =>
			ts.isPropertyAssignment(property) &&
			(ts.isIdentifier(property.name) ||
				ts.isStringLiteral(property.name)) &&
			property.name.text === name
	);

/* Every leaf route's `component: X` identifier, through nested children. */
const leafComponents = (routes: TS.ArrayLiteralExpression) => {
	const found: TS.Identifier[] = [];
	const visitRoutes = (array: TS.ArrayLiteralExpression) => {
		for (const element of array.elements) {
			if (!ts.isObjectLiteralExpression(element)) continue;
			const children = propertyNamed(element, 'children');
			const nested = children?.initializer;
			if (nested && ts.isArrayLiteralExpression(nested))
				visitRoutes(nested);
			if (children) continue;
			const component = propertyNamed(element, 'component');
			if (component && ts.isIdentifier(component.initializer))
				found.push(component.initializer);
		}
	};
	visitRoutes(routes);

	return found;
};

const routeArrays = (file: TS.SourceFile) => {
	const arrays: TS.ArrayLiteralExpression[] = [];
	const visit = (node: TS.Node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'defineRoutes'
		) {
			const [routes] = node.arguments;
			if (routes && ts.isArrayLiteralExpression(routes))
				arrays.push(routes);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);

	return arrays;
};

/**
 * The module script with its route pages loading lazily, or null when
 * nothing changes. `wholeFile` is the full SFC, so a component the
 * template or `<script setup>` also uses stays eager.
 */
export const splitVueRoutePages = (script: string, wholeFile: string) => {
	if (!script.includes('defineRoutes')) return null;
	const file = ts.createSourceFile(
		'absolute-vue-routes.ts',
		script,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const candidates = readCandidates(file);
	if (candidates.size === 0) return null;
	const uses = routeArrays(file)
		.flatMap(leafComponents)
		.filter((identifier) => candidates.has(identifier.text));
	if (uses.length === 0) return null;

	const lazy = new Set<string>();
	for (const name of new Set(uses.map((identifier) => identifier.text))) {
		const candidate = candidates.get(name);
		if (!candidate) continue;
		const importText = script.slice(
			candidate.declaration.getStart(),
			candidate.declaration.end
		);
		const pattern = new RegExp(`\\b${name}\\b`, 'g');
		const everywhere = wholeFile.match(pattern)?.length ?? 0;
		const inImport = importText.match(pattern)?.length ?? 0;
		const asRoutes = uses.filter(
			(identifier) => identifier.text === name
		).length;
		if (everywhere - inImport === asRoutes) lazy.add(name);
	}
	if (lazy.size === 0) return null;

	const edits: [number, number, string][] = [];
	for (const identifier of uses) {
		const candidate = candidates.get(identifier.text);
		if (!candidate || !lazy.has(identifier.text)) continue;
		edits.push([
			identifier.getStart(),
			identifier.end,
			`() => import(${JSON.stringify(candidate.specifier)})`
		]);
	}
	for (const name of lazy) {
		const candidate = candidates.get(name);
		if (candidate)
			edits.push([
				candidate.declaration.getStart(),
				candidate.declaration.end,
				''
			]);
	}

	return edits
		.sort((left, right) => right[0] - left[0])
		.reduce(
			(output, [start, end, text]) =>
				output.slice(0, start) + text + output.slice(end),
			script
		);
};
