import type {
	HoleComponent,
	HoleContent,
	HoleContext,
	RouteHoles
} from '../../types/routeHoles';
import type { StreamingSlot } from '../utils/streamingSlots';
import { logWarn } from '../utils/logger';
import {
	isUnresolvedSlot,
	slotInRenderContext
} from './streamingSlotRegistrar';
import {
	renderAngularIslandToHtml,
	renderReactIslandToHtml,
	renderSvelteIslandToHtml,
	renderVueIslandToHtml
} from './islandSsr';

/* Route-level holes.
 *
 * A partially pre-rendered page is a cached shell with dynamic slots in
 * it, and each request fills those slots (partialPrerender.ts). The
 * slot's resolver used to live only inside the page — a prop on a
 * `<StreamSlot dynamic>` — so the one way to reach it was to run the
 * route's handler and render the page again, and throw the page away.
 * Measured on a React page, that is about 60% of the CPU of rendering it
 * from scratch, on every request, plus every query the handler makes
 * for the static parts nobody will see.
 *
 * A hole declared here is reached without any of that. It is a function
 * of the request, registered against the route's path:
 *
 *     defineHoles('/dashboard', {
 *       cart: async ({ request }) => `<p>${await cartCount(request)}</p>`
 *     });
 *
 * or, for a file route, an export of its server module:
 *
 *     export const holes = { cart: async ({ request }) => … };
 *
 * The page keeps `<StreamSlot dynamic id="cart" fallbackHtml="…" />` as
 * the placeholder. When every hole of a shell is declared this way, the
 * server fills them and the route is never run. A page that is rendered
 * anyway — in development, or a route that is not pre-rendered — uses
 * the same resolver for that slot, so there is one definition of what
 * the slot shows.
 *
 * WHAT IS NOT RUN: the route's `beforeHandle` and its folders' guards.
 * They belong to the route, and the route is what is being skipped. A
 * resolver that shows something private checks the request itself.
 *
 * The registry is on globalThis under Symbol.for, as the slot registry
 * is: the server and each framework's page-handler bundle carry their
 * own copy of this module and must see the same routes. */

type RegisteredHoles = {
	/** Names of the path's params, in the order its pattern captures. */
	names: string[];
	path: string;
	pattern: RegExp;
	load: () => Promise<RouteHoles | undefined> | RouteHoles | undefined;
};

type HolesRegistry = { routes: Map<string, RegisteredHoles> };

const REGISTRY_KEY = Symbol.for('absolutejs.routeHoles');
const COMPONENT_KIND = 'absolute:hole-component';

const isRegistry = (value: unknown): value is HolesRegistry =>
	typeof value === 'object' &&
	value !== null &&
	'routes' in value &&
	value.routes instanceof Map;

const registry = () => {
	const existing: unknown = Reflect.get(globalThis, REGISTRY_KEY);
	if (isRegistry(existing)) return existing;
	const created: HolesRegistry = { routes: new Map() };
	Reflect.set(globalThis, REGISTRY_KEY, created);

	return created;
};

const escapeForRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Segment = { name?: string; source: string };

/* One segment of a route path as Elysia writes it: `:name` is one
 * segment, `:name?` one or none, `*` everything from there on. */
const segmentOf = (segment: string): Segment => {
	if (segment === '*') return { name: '*', source: '(?:/(.*))?' };
	if (!segment.startsWith(':'))
		return { source: `/${escapeForRegExp(segment)}` };
	const optional = segment.endsWith('?');
	const name = segment.slice(1, optional ? -1 : undefined);

	return { name, source: optional ? '(?:/([^/]+))?' : '/([^/]+)' };
};

const compile = (path: string) => {
	const segments = path.split('/').filter(Boolean).map(segmentOf);

	return {
		names: segments.flatMap(({ name }) =>
			name === undefined ? [] : [name]
		),
		pattern: new RegExp(
			`^${segments.map(({ source }) => source).join('')}/?$`
		)
	};
};

const decode = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const register = (
	path: string,
	load: RegisteredHoles['load'],
	catchAll?: string
) => {
	const { names, pattern } = compile(path);
	registry().routes.set(path, {
		load,
		names: names.map((name) =>
			name === '*' && catchAll !== undefined ? catchAll : name
		),
		path,
		pattern
	});
};

const describe = (
	framework: HoleComponent['framework'],
	component: unknown,
	props: Record<string, unknown>
) => {
	const described: HoleComponent = {
		component,
		framework,
		kind: COMPONENT_KIND,
		props
	};

	return described;
};

type AngularComponent = import('@angular/core').Type<object>;
type ReactComponent<Props> = import('react').ComponentType<Props>;
type SvelteComponent<Props extends Record<string, unknown>> =
	import('svelte').Component<Props>;
type VueComponent<Props> = import('vue').Component<Props>;

type HoleComponents = {
	angular: (
		component: AngularComponent,
		props?: Record<string, unknown>
	) => HoleComponent;
	react: <Props extends Record<string, unknown>>(
		component: ReactComponent<Props>,
		props: Props
	) => HoleComponent;
	svelte: <Props extends Record<string, unknown>>(
		component: SvelteComponent<Props>,
		props: Props
	) => HoleComponent;
	vue: <Props extends Record<string, unknown>>(
		component: VueComponent<Props>,
		props: Props
	) => HoleComponent;
};

/** A component as a hole's content, rendered on its own on the server:
 *
 *      cart: async ({ request }) =>
 *        holeComponent.react(CartSummary, { cart: await loadCart(request) })
 *
 *  Any framework, on any page: a React page can have a Svelte hole. The
 *  markup arrives as HTML and is not hydrated. */
export const holeComponent: HoleComponents = {
	angular: (component, props = {}) => describe('angular', component, props),
	react: (component, props) => describe('react', component, props),
	svelte: (component, props) => describe('svelte', component, props),
	vue: (component, props) => describe('vue', component, props)
};

const isHoleComponent = (value: unknown): value is HoleComponent =>
	typeof value === 'object' &&
	value !== null &&
	'kind' in value &&
	value.kind === COMPONENT_KIND;

/* `holeComponent` checked each component against its framework's own
 * type where it was written. What is left to tell here is only that it
 * is something a renderer can be handed at all. */
const isRenderable = (value: unknown) =>
	typeof value === 'function' ||
	(typeof value === 'object' && value !== null);

const isAngularComponent = (value: unknown): value is AngularComponent =>
	typeof value === 'function';
const isReactComponent = (
	value: unknown
): value is ReactComponent<Record<string, unknown>> => isRenderable(value);
const isSvelteComponent = (
	value: unknown
): value is SvelteComponent<Record<string, unknown>> =>
	typeof value === 'function';
const isVueComponent = (
	value: unknown
): value is VueComponent<Record<string, unknown>> => isRenderable(value);

/* The renderers are the islands' (islandSsr.ts): a component rendered
 * outside any page is what an island is on the server. */
const renderComponent = (
	{ component, framework, props }: HoleComponent,
	id: string
) => {
	if (framework === 'angular' && isAngularComponent(component))
		return renderAngularIslandToHtml(component, props, id);
	if (framework === 'react' && isReactComponent(component))
		return renderReactIslandToHtml(component, props);
	if (framework === 'svelte' && isSvelteComponent(component))
		return renderSvelteIslandToHtml(component, props);
	if (framework === 'vue' && isVueComponent(component))
		return renderVueIslandToHtml(component, props);

	throw new TypeError(
		`Hole "${id}" was given something that is not a ${framework} component.`
	);
};

const renderContent = (content: HoleContent, id: string) => {
	if (typeof content === 'string') return content;
	if (isHoleComponent(content)) return renderComponent(content, id);

	throw new TypeError(
		`Hole "${id}" resolved to neither HTML nor a holeComponent.`
	);
};

/** Declares the holes of the route at `path`: the dynamic parts of its
 *  pre-rendered page, each a function of the visitor's request, keyed
 *  by the `id` of the slot it fills.
 *
 *      defineHoles('/dashboard', {
 *        cart: async ({ request }) => `<p>${await cartCount(request)}</p>`
 *      });
 *
 *  `path` is written as the route is registered (`/blog/:slug`), and its
 *  params reach the resolver. When every dynamic slot of the page has a
 *  hole here, the server fills them without running the route at all —
 *  so neither its handler nor its `beforeHandle` runs for that request,
 *  and a resolver that shows something private must check the request
 *  itself. Call it where the routes are defined; calling it again for
 *  the same path replaces what was there. */
export const defineHoles = (path: string, holes: RouteHoles) => {
	register(path, () => holes);
};

type MatchedHoles = { context: HoleContext; holes: RouteHoles };

const paramsOf = (route: RegisteredHoles, match: RegExpExecArray) =>
	Object.fromEntries(
		route.names.flatMap((name, index) => {
			const value = match[index + 1];

			return value === undefined ? [] : [[name, decode(value)]];
		})
	);

const findRoute = (pathname: string) => {
	const { routes } = registry();
	const literal = routes.get(pathname.replace(/\/+$/, '') || '/');
	if (literal)
		return { match: literal.pattern.exec(pathname), route: literal };
	for (const route of routes.values()) {
		const match = route.pattern.exec(pathname);
		if (match) return { match, route };
	}

	return undefined;
};

/** @internal Whether any route has declared holes: the cheap question a
 *  page render asks before the dearer one. */
export const hasRouteHoles = () => registry().routes.size > 0;

/** @internal The holes declared for the route `request` is for. */
export const matchRouteHoles = async (request: Request) => {
	const found = findRoute(new URL(request.url).pathname);
	if (!found?.match) return undefined;
	const holes = await found.route.load();
	if (!holes) return undefined;
	const matched: MatchedHoles = {
		context: { params: paramsOf(found.route, found.match), request },
		holes
	};

	return matched;
};

/** @internal Registers a route's holes, loaded when first needed.
 *  `catchAll` is the name a file route gave its `*` segment. */
export const registerRouteHoles = (
	path: string,
	load: RegisteredHoles['load'],
	catchAll?: string
) => {
	register(path, load, catchAll);
};

const slotFor = (
	id: string,
	{ context, holes }: MatchedHoles,
	base: Partial<StreamingSlot> = {}
) => {
	const resolver = holes[id];
	if (!resolver) return undefined;
	const slot: StreamingSlot = {
		...base,
		id,
		resolve: async () => renderContent(await resolver(context), id)
	};

	return slot;
};

const warned = new Set<string>();

/* Said once per route: every request to it pays for the page render
 * this exists to avoid, and nothing else would show it. */
const warnPartlyDeclared = (pathname: string, missing: string[]) => {
	if (warned.has(pathname)) return;
	warned.add(pathname);
	logWarn(
		`${pathname} declares holes, but not for every dynamic slot of its page (missing: ${missing.join(', ')}). The route is still run for each request to fill them all; declare the rest to skip it.`
	);
};

/** @internal The slots that fill a shell's holes without running its
 *  route — or undefined when the route has not declared every one of
 *  them, and the page has to be rendered to reach the rest. */
export const routeHoleSlots = async (request: Request, ids: string[]) => {
	if (!hasRouteHoles()) return undefined;
	const matched = await matchRouteHoles(request);
	if (!matched) return undefined;
	const missing = ids.filter((id) => !(id in matched.holes));
	if (missing.length > 0) {
		warnPartlyDeclared(new URL(request.url).pathname, missing);

		return undefined;
	}

	return ids.flatMap((id) => slotFor(id, matched) ?? []);
};

/** @internal `slots` as a page registered them, with the resolver of
 *  each one the route declared a hole for replaced by the route's. The
 *  route's wins: it is what fills the slot when the page is not
 *  rendered, and a slot must not show one thing from the cache and
 *  another in development. */
export const withRouteHoles = async (
	slots: StreamingSlot[],
	request: Request | undefined
) => {
	if (!request || slots.length === 0 || !hasRouteHoles()) return slots;
	const matched = await matchRouteHoles(request);
	if (!matched) return slots;

	/* In the context of the request being rendered, as the resolver it
	 * replaces was: a hole that calls `cookies()` must find the
	 * visitor's, long after the render that registered it returned. */
	return slots.map((slot) => {
		const declared = slotFor(slot.id, matched, slot);

		return declared ? slotInRenderContext(declared) : slot;
	});
};

const unfilled = new Set<string>();

/** @internal Says, once per slot, that a page is being sent with a slot
 *  nothing will fill: it was written without a `resolve`, as the
 *  placeholder for a hole, and its route declares no hole of that id. */
export const warnUnfilledSlots = (
	slots: StreamingSlot[],
	request: Request | undefined
) => {
	const pathname = request ? new URL(request.url).pathname : '(unknown)';
	slots
		.filter(isUnresolvedSlot)
		.filter(({ id }) => !unfilled.has(`${pathname}#${id}`))
		.forEach(({ id }) => {
			unfilled.add(`${pathname}#${id}`);
			logWarn(
				`${pathname}: slot "${id}" has no \`resolve\`, and the route declares no hole "${id}", so it will never be filled. Give the slot a \`resolve\`, or declare the hole with defineHoles() or the route's \`holes\` export.`
			);
		});
};
