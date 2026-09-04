import { env } from 'bun';
import { Elysia, NotFound, type AnyElysia } from 'elysia';
import { buildGlobalWSHandler } from 'elysia/ws';
import { DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS } from '../constants';

/* `lazyPlugin` — defer a route-owning plugin's module graph past boot.
 *
 * Elysia composes routes at `.use()` time and freezes them into Bun.serve's
 * handler table at `.listen()`, so a module that owns routes has to be
 * evaluated during boot. On a large app that is the single most expensive
 * import in the entry (`ABSOLUTE_DEV_IMPORT_COST=1` reports it as
 * `used at module scope`, which is exactly the verdict that says "you cannot
 * fix this by moving the import line").
 *
 * `lazyPlugin` registers two placeholder routes for the prefix the plugin
 * owns — `${prefix}` and `${prefix}/*` — so the app still answers under that
 * prefix from the moment it listens. The first request that lands on one of
 * them imports the module, composes it onto the live app with the real
 * `.use()`, and re-dispatches. Every later request matches the plugin's own
 * routes directly and never reaches the placeholder.
 *
 * See `docs/DEV_PERFORMANCE.md` for the ergonomics, the prefix requirement,
 * and the production behaviour. */

/** Guards `{ default: { default: … } }` shaped module chains. */
const MAX_MODULE_UNWRAP_DEPTH = 8;

/** Elysia's own `#useAsync` skips this key when unwrapping a namespace. */
const MODULE_META_KEYS = new Set(['__esModule']);

type PluginFactory = (...args: readonly unknown[]) => unknown;

/* Only the sliver of `Bun.Server` this module touches. Bun's own `Server<T>`
 * pins the WebSocket data type, and `app.server` resolves it to `unknown`,
 * which no real socket handler satisfies — the structural shape sidesteps a
 * generic mismatch that has nothing to do with what a reload actually needs. */
type ReloadableServer = {
	reload: (options: Record<string, unknown>) => unknown;
};

export type LazyPluginOptions = {
	/**
	 * Applied to `load`'s result when it resolves to a factory function. The
	 * type-safe alternative is to bind the dependencies in the closure:
	 * `load: async () => (await import('./api')).apiPlugin(db)`.
	 */
	args?: readonly unknown[];
	/**
	 * Force the eager path (a plain `.use()`) or the lazy one. Defaults to
	 * eager in production and in compiled binaries, lazy everywhere else.
	 */
	eager?: boolean;
	/** Label used in error messages. Defaults to the prefix. */
	name?: string;
	/**
	 * The path prefix the plugin owns, e.g. `/api`. Every route the plugin
	 * declares has to live under it, and nothing else may claim it.
	 */
	prefix: string;
	/**
	 * Produces the plugin. Return the instance, `{ default: instance }`, a
	 * module namespace with a single plugin export, or a factory (called with
	 * `args`).
	 */
	load: () => unknown;
};

const isElysiaInstance = (value: unknown): value is AnyElysia =>
	value instanceof Elysia;

const isPluginFactory = (value: unknown): value is PluginFactory =>
	typeof value === 'function';

const isModuleNamespace = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const labelOf = (options: LazyPluginOptions, prefix: string) =>
	options.name ?? prefix;

const normalizePrefix = (prefix: string) => {
	const trimmed = prefix.replace(/\/+$/, '');
	if (trimmed.startsWith('/') && trimmed.length > 1) return trimmed;

	throw new Error(
		`[AbsoluteJS] lazyPlugin({ prefix: ${JSON.stringify(prefix)} }) is not usable. A lazy plugin has to own a path prefix — it is what lets the app answer under that path before the module is evaluated — so the prefix must start with "/" and name at least one segment (e.g. "/api").`
	);
};

const pickNamespaceExport = (
	namespace: Record<string, unknown>,
	label: string
) => {
	const candidates = Object.entries(namespace).filter(
		([key, value]) =>
			!MODULE_META_KEYS.has(key) &&
			(isElysiaInstance(value) || isPluginFactory(value))
	);
	const [only] = candidates;
	if (candidates.length === 1 && only !== undefined) return only[1];

	throw new Error(
		`[AbsoluteJS] lazyPlugin(${label}) could not tell which export is the plugin. The module exports ${JSON.stringify(Object.keys(namespace))}. Return it from load() instead, e.g. load: async () => (await import('./api')).apiPlugin(db).`
	);
};

/** Recursive: `default` chains and namespaces both unwrap to the same shape. */
const unwrapModule = (
	value: unknown,
	label: string,
	depth: number
): AnyElysia | PluginFactory => {
	if (isElysiaInstance(value)) return value;
	if (isPluginFactory(value)) return value;
	if (depth >= MAX_MODULE_UNWRAP_DEPTH || !isModuleNamespace(value))
		throw new Error(
			`[AbsoluteJS] lazyPlugin(${label}) expected load() to resolve to an Elysia instance, a module exporting one, or a factory returning one, but got ${typeof value}.`
		);

	const inner =
		'default' in value ? value.default : pickNamespaceExport(value, label);

	return unwrapModule(inner, label, depth + 1);
};

const loadPlugin = async (options: LazyPluginOptions, prefix: string) => {
	const label = labelOf(options, prefix);
	const unwrapped = unwrapModule(await options.load(), label, 0);
	if (isElysiaInstance(unwrapped)) return unwrapped;

	const produced = await unwrapped(...(options.args ?? []));
	if (isElysiaInstance(produced)) return produced;

	throw new Error(
		`[AbsoluteJS] lazyPlugin(${label}) called the exported factory but it returned ${typeof produced}, not an Elysia instance. Pass its dependencies with the \`args\` option, or bind them in load(): load: async () => (await import('./api')).apiPlugin(db).`
	);
};

const hasWebsocketRoutes = (app: AnyElysia) =>
	Reflect.get(app, '~hasWS') === true;

const isLiveServer = (value: unknown): value is ReloadableServer =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'reload') === 'function';

/* Bun's serve config captured `app.fetch` when `.listen()` published the
 * handler (`live = serve.fetch = withOrigin(built.fetch)` in Elysia's Bun
 * adapter), so a route table rebuilt after that point is invisible to the
 * socket until the handler is swapped. This is the same swap the dev HMR path
 * performs in `plugins/networking.ts`; the replacement reads `app.fetch`
 * per request, so a later lazy mount needs no further reload. `routes: {}`
 * clears Bun's compiled static map for the same reason it does there —
 * entries in it bypass `fetch` entirely. */
const rebindLiveServer = (app: AnyElysia) => {
	const { server } = app;
	if (!isLiveServer(server)) return;

	const forward = (request: Request) => app.fetch(request);
	if (!hasWebsocketRoutes(app)) {
		server.reload({ fetch: forward, routes: {} });

		return;
	}

	// Mirrors the dev reload in `plugins/networking.ts`: a Bun reload replaces
	// the whole handler set, so an app that owns WebSocket routes has to hand
	// its socket handler back or every upgrade after this point 400s.
	server.reload({
		fetch: forward,
		routes: {},
		websocket: {
			idleTimeout: DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
			sendPings: true,
			...buildGlobalWSHandler()
		}
	});
};

export const lazyPlugin = (options: LazyPluginOptions) => {
	const prefix = normalizePrefix(options.prefix);
	const label = labelOf(options, prefix);
	const eager =
		options.eager ??
		(env.NODE_ENV === 'production' ||
			env.ABSOLUTE_COMPILED_RUNTIME === '1');

	return <A extends AnyElysia>(app: A) => {
		if (eager) {
			app.use(loadPlugin(options, prefix));

			return app;
		}

		let mounted = false;
		let loading: Promise<AnyElysia> | undefined;
		let composeFailure: { error: unknown } | undefined;

		// Synchronous, so between the first statement and the last no other
		// request can observe a half-composed app.
		const compose = (plugin: AnyElysia) => {
			// Elysia seals an app once its fetch handler is built. Unsealing,
			// composing, and republishing a generation is the same swap the
			// dev HMR path performs to put a new route table under a live
			// socket (`plugins/networking.ts`).
			Reflect.set(app, '~generation', undefined);
			app.use(plugin);
			app['~newGeneration']();
			mounted = true;
			rebindLiveServer(app);
		};

		// A load can fail transiently (a syntax error the developer is about to
		// fix), so it is retried on the next request. Composition cannot be
		// retried — the plugin is already spliced into the app — so its failure
		// is replayed instead of being swallowed into a hang.
		const composeOnce = (plugin: AnyElysia) => {
			if (composeFailure) throw composeFailure.error;
			if (mounted) return;

			try {
				compose(plugin);
			} catch (error) {
				composeFailure = { error };
				throw error;
			}
		};

		const dispatch = async (request: Request) => {
			// Reached again after the mount only when nothing under the prefix
			// matches — the plugin's own routes always win over the wildcard.
			if (mounted) throw new NotFound();

			loading ??= loadPlugin(options, prefix);
			let plugin;
			try {
				plugin = await loading;
			} catch (error) {
				loading = undefined;
				throw error;
			}
			composeOnce(plugin);

			return app.fetch(request);
		};

		// `parse: 'none'` keeps the placeholder from consuming the body, so the
		// re-dispatched request still carries it. `hide` keeps two synthetic
		// routes out of the OpenAPI document.
		const placeholder = {
			detail: {
				description: `Lazily mounted plugin (${label})`,
				hide: true
			},
			parse: 'none'
		} as const;

		app.all(prefix, placeholder, ({ request }) => dispatch(request));
		app.all(`${prefix}/*`, placeholder, ({ request }) => dispatch(request));

		return app;
	};
};
