/* Pages placed in the Svelte router load their code the first time they
 * are shown, with nothing for the app to write: the Svelte counterpart of
 * build/splitRoutePages.ts.
 *
 *   <Route path="/editor/:id">
 *     {#snippet content(params)}<Editor id={params.id} readOnly={false} />{/snippet}
 *   </Route>
 *
 * becomes, before either the server or the browser module is compiled,
 *
 *   <Route path="/editor/:id" loader={() => import('./Editor.svelte')}
 *     props={{ readOnly: false }}></Route>
 *
 * which the router already renders lazily (docs/SVELTE_ROUTER_LAZY_LOADING.md):
 * the page is its own chunk, the server awaits it so the HTML is complete,
 * the browser loads it before hydrating, and the route params reach it as
 * props, as `id={params.id}` did.
 *
 * Split: a `content` snippet whose whole body is one component imported
 * from a local `.svelte` file, used nowhere else in the file, whose props
 * are plain attributes. A snippet parameter may only be passed through
 * under its own name (`id={params.id}`): the router does that already.
 * Anything else (several elements, a layout of nested routes, a spread, a
 * directive, a prop computed from the params) stays as written. */

type Node = {
	end: number;
	start: number;
	type: string;
	[key: string]: unknown;
};

type ParseSvelte = (source: string, options: { modern: true }) => unknown;

const ROUTE_SOURCE = /(^|\/)svelte\/router\/Route\.svelte$/;
const LOCAL_SVELTE = /^\.{1,2}\/.*\.svelte$/;

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'type') === 'string' &&
	typeof Reflect.get(value, 'start') === 'number' &&
	typeof Reflect.get(value, 'end') === 'number';

const nodesOf = (value: unknown) =>
	Array.isArray(value) ? value.filter(isNode) : [];

const childNodes = (node: Node) => {
	const fragment = node.fragment ?? node.body;
	if (
		!isNode(fragment) &&
		!(typeof fragment === 'object' && fragment !== null)
	)
		return [];

	return nodesOf(Reflect.get(fragment, 'nodes'));
};

const isBlank = (node: Node, source: string) =>
	node.type === 'Text' && source.slice(node.start, node.end).trim() === '';

const meaningful = (nodes: Node[], source: string) =>
	nodes.filter((node) => !isBlank(node, source));

type Import = { declaration: Node; local: string; specifier: string };

/* An import statement's default bindings (how a component is imported). */
const defaultImports = (statement: Node) => {
	const none: Import[] = [];
	if (statement.type !== 'ImportDeclaration') return none;
	const source = Reflect.get(Object(statement.source), 'value');
	if (typeof source !== 'string') return none;

	return nodesOf(statement.specifiers)
		.filter((specifier) => specifier.type === 'ImportDefaultSpecifier')
		.map((specifier) => Reflect.get(Object(specifier.local), 'name'))
		.filter((local): local is string => typeof local === 'string')
		.map((local) => ({ declaration: statement, local, specifier: source }));
};

const readImports = (ast: unknown) => {
	const instance = Reflect.get(Object(ast), 'instance');
	const program = instance ? Reflect.get(instance, 'content') : undefined;
	const body = program ? nodesOf(Reflect.get(program, 'body')) : [];

	return body.flatMap(defaultImports);
};

/* An attribute's value parts: a list of text and expression tags, or one. */
const attributeParts = (value: unknown) => {
	if (Array.isArray(value)) return nodesOf(value);

	return isNode(value) ? [value] : [];
};

/* A plain attribute as an object property, or null when it can't move:
 * `undefined` when it is a route param passed through (the router passes
 * those itself). */
const attributeProperty = (
	attribute: Node,
	source: string,
	param: string | null
) => {
	if (attribute.type !== 'Attribute') return null;
	const { name } = attribute;
	if (typeof name !== 'string') return null;
	const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
	const { value } = attribute;
	if (value === true) return `${key}: true`;
	const parts = attributeParts(value);
	if (parts.length !== 1) return null;
	const [part] = parts;
	if (!part) return null;
	if (part.type === 'Text')
		return `${key}: ${JSON.stringify(Reflect.get(part, 'data') ?? source.slice(part.start, part.end))}`;
	if (part.type !== 'ExpressionTag') return null;
	const expression = Reflect.get(part, 'expression');
	if (!isNode(expression)) return null;
	const text = source.slice(expression.start, expression.end);
	if (param !== null && new RegExp(`\\b${param}\\b`).test(text)) {
		// Only `name={param.name}`: the router hands the param over itself.
		return text.replace(/\s+/g, '') === `${param}.${name}`
			? undefined
			: null;
	}

	return `${key}: ${text}`;
};

type Split = {
	edits: [number, number, string][];
	local: string;
	/** The source this split replaces: where its mentions of the page are. */
	region: { end: number; start: number };
	/** Uses LazyPage (a page inside a wrapper), which needs its import. */
	wrapped: boolean;
};

const LAZY_PAGE = 'AbsoluteRoutePage';

/* A route's `content` snippet, when the route can take a lazy page. */
const contentSnippet = (route: Node, source: string) => {
	const attributes = nodesOf(route.attributes);
	if (
		attributes.some(
			(attribute) =>
				attribute.name === 'loader' || attribute.name === 'content'
		)
	)
		return null;

	return (
		meaningful(childNodes(route), source).find(
			(node) =>
				node.type === 'SnippetBlock' &&
				Reflect.get(Object(node.expression), 'name') === 'content'
		) ?? null
	);
};

const splitRoute = (
	route: Node,
	source: string,
	components: Map<string, Import>
): Split | null => {
	const attributes = nodesOf(route.attributes);
	const snippet = contentSnippet(route, source);
	if (!snippet) return null;
	const parameters = nodesOf(snippet.parameters);
	if (parameters.length > 1) return null;
	const [parameter] = parameters;
	const param = parameter ? Reflect.get(parameter, 'name') : null;
	if (parameter && typeof param !== 'string') return null;
	const body = meaningful(childNodes(snippet), source);
	const [page] = body;
	if (body.length !== 1 || !page || page.type !== 'Component') return null;
	const local = page.name;
	if (typeof local !== 'string' || !components.has(local)) return null;
	if (meaningful(childNodes(page), source).length > 0) return null;
	const properties: string[] = [];
	for (const attribute of nodesOf(page.attributes)) {
		const property = attributeProperty(
			attribute,
			source,
			typeof param === 'string' ? param : null
		);
		if (property === null) return null;
		if (property !== undefined) properties.push(property);
	}
	const imported = components.get(local);
	if (!imported) return null;
	const lastAttribute = attributes.at(-1);
	const insertAt = lastAttribute
		? lastAttribute.end
		: route.start + 1 + String(route.name).length;
	const loader = ` loader={() => import(${JSON.stringify(imported.specifier)})}`;
	const props =
		properties.length > 0 ? ` props={{ ${properties.join(', ')} }}` : '';

	return {
		edits: [
			[insertAt, insertAt, `${loader}${props}`],
			[snippet.start, snippet.end, '']
		],
		local,
		region: { end: snippet.end, start: snippet.start },
		wrapped: false
	};
};

/* A route whose snippet wraps its page (a frame, a guard): each page in
 * it, a local component wrapping no content of its own, becomes a
 * LazyPage in place. The wrappers and the snippet stay as written, so a
 * page's props may use the route params; the page's own route nested
 * inside (a layout) is the outer walk's to handle. */
const splitWrappedPages = (
	route: Node,
	source: string,
	components: Map<string, Import>,
	routeNames: Set<string>
) => {
	const snippet = contentSnippet(route, source);
	if (!snippet) return [];
	const pathAttribute = nodesOf(route.attributes).find(
		(attribute) => attribute.name === 'path'
	);
	const routePath = pathAttribute
		? source.slice(pathAttribute.start, pathAttribute.end)
		: '';
	const pages: Split[] = [];
	const visitPages = (node: Node) => {
		if (node.type === 'Component' && routeNames.has(String(node.name)))
			return;
		const page = wrappedPage(node, source, components);
		if (page) {
			const index = pages.length;
			const id = `${routePath}|${page.specifier}|${index}`;
			const props =
				page.properties.length > 0
					? ` props={{ ${page.properties.join(', ')} }}`
					: '';
			pages.push({
				edits: [
					[
						node.start,
						node.end,
						`<${LAZY_PAGE} id={${JSON.stringify(id)}} loader={() => import(${JSON.stringify(page.specifier)})}${props} />`
					]
				],
				local: page.local,
				region: { end: node.end, start: node.start },
				wrapped: true
			});

			return;
		}
		for (const child of childNodes(node)) visitPages(child);
	};
	for (const child of childNodes(snippet)) visitPages(child);

	return pages;
};

/* A page component inside a wrapper: local, wrapping nothing, with plain
 * attributes (any expression: it stays in the snippet's scope). */
const wrappedPage = (
	node: Node,
	source: string,
	components: Map<string, Import>
) => {
	if (node.type !== 'Component' || typeof node.name !== 'string') return null;
	const imported = components.get(node.name);
	if (!imported) return null;
	if (meaningful(childNodes(node), source).length > 0) return null;
	const properties = nodesOf(node.attributes).map((attribute) =>
		attributeProperty(attribute, source, null)
	);
	if (properties.some((property) => typeof property !== 'string'))
		return null;

	return {
		local: node.name,
		properties: properties.filter(
			(property): property is string => typeof property === 'string'
		),
		specifier: imported.specifier
	};
};

const walk = (node: Node, visit: (node: Node) => void) => {
	visit(node);
	for (const child of childNodes(node)) walk(child, visit);
	for (const attribute of nodesOf(node.attributes)) {
		const { value } = attribute;
		for (const part of Array.isArray(value) ? nodesOf(value) : [])
			walk(part, visit);
	}
};

/* References to `name` in a parsed component: its tags (`<Home />`) and
 * identifiers in code and template expressions, outside import
 * declarations. Text and comments are not nodes of either kind. */
const svelteReferences = (ast: unknown, name: string) => {
	let count = 0;
	const seen = new WeakSet<object>();
	const visit = (value: unknown) => {
		if (typeof value !== 'object' || value === null || seen.has(value))
			return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) visit(item);

			return;
		}
		const type = Reflect.get(value, 'type');
		if (type === 'ImportDeclaration') return;
		const nodeName = Reflect.get(value, 'name');
		if (
			(type === 'Component' || type === 'Identifier') &&
			nodeName === name
		)
			count += 1;
		for (const key of Object.keys(value)) {
			if (key === 'metadata' || key === 'parent') continue;
			visit(Reflect.get(value, key));
		}
	};
	visit(ast);

	return count;
};

/** The component with its router pages loading lazily, or null when
 *  nothing in it changes. */
export const lowerSvelteRoutePages = (source: string, parse: ParseSvelte) => {
	if (
		!source.includes('<Route') ||
		!source.includes('svelte/router/Route.svelte')
	)
		return null;
	let ast: unknown;
	try {
		ast = parse(source, { modern: true });
	} catch {
		// The compiler reports the syntax error itself, from the source as
		// written.
		return null;
	}
	const imports = readImports(ast);
	const routeNames = new Set(
		imports
			.filter((entry) => ROUTE_SOURCE.test(entry.specifier))
			.map((entry) => entry.local)
	);
	if (routeNames.size === 0) return null;
	// A page's import is removed whole, so only one that imports nothing
	// else is split.
	const components = new Map(
		imports
			.filter(
				(entry) =>
					LOCAL_SVELTE.test(entry.specifier) &&
					nodesOf(entry.declaration.specifiers).length === 1
			)
			.map((entry) => [entry.local, entry])
	);
	const fragment = Reflect.get(Object(ast), 'fragment');
	if (!fragment) return null;
	const splits: Split[] = [];
	const root: Node = { end: source.length, fragment, start: 0, type: 'Root' };
	walk(root, (node) => {
		if (node.type !== 'Component' || !routeNames.has(String(node.name)))
			return;
		const split = splitRoute(node, source, components);
		if (split) splits.push(split);
		else
			splits.push(
				...splitWrappedPages(node, source, components, routeNames)
			);
	});
	if (splits.length === 0) return null;

	// A page the file also uses anywhere else stays eager: every reference
	// to it (a tag, an identifier in code) must be one of the page tags
	// being replaced. The word in text ("Home" as a link's label) or in a
	// comment is not a reference.
	const lazyLocals = new Set<string>();
	for (const local of new Set(splits.map((split) => split.local))) {
		const pageTags = splits.filter((split) => split.local === local).length;
		if (svelteReferences(ast, local) === pageTags) lazyLocals.add(local);
	}
	const kept = splits.filter((split) => lazyLocals.has(split.local));
	if (kept.length === 0) return null;
	const edits = kept.flatMap((split) => split.edits);
	for (const local of lazyLocals) {
		const imported = components.get(local);
		if (imported)
			edits.push([
				imported.declaration.start,
				imported.declaration.end,
				''
			]);
	}
	// LazyPage comes from beside the Route this file imports.
	const routeImport = imports.find((entry) =>
		ROUTE_SOURCE.test(entry.specifier)
	);
	if (kept.some((split) => split.wrapped) && routeImport)
		edits.push([
			routeImport.declaration.end,
			routeImport.declaration.end,
			`\n\timport ${LAZY_PAGE} from ${JSON.stringify(routeImport.specifier.replace(/Route\.svelte$/, 'LazyPage.svelte'))};`
		]);

	// Apply from the end so earlier offsets stay valid.
	return edits
		.sort((left, right) => right[0] - left[0] || right[1] - left[1])
		.reduce(
			(output, [start, end, text]) =>
				output.slice(0, start) + text + output.slice(end),
			source
		);
};
