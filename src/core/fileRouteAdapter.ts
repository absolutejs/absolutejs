import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteFramework,
	FileRouteGuardModule,
	FileRouteParams,
	FileRouteRenderInput,
	FileRouteServerModule
} from '../../types/fileRoutes';

/* Shared by the framework adapters (`reactFileRoute`, `svelteFileRoute`):
 * turns a route's lazily imported server module into the framework-neutral
 * hooks `fileRoutes()` runs. The adapters' generics check, at compile time,
 * that the module's `load` takes this route's params and returns the page's
 * props; at run time the request's params are checked against the path. */

const PARAM_NAME_RE = /:([A-Za-z_$][\w$]*)(\?)?/g;

/* The params a request must carry for the route's `load` to be given a
 * context of the type it was written against. An `[[optional]]` segment is
 * typed `:name?` and is exactly the param that may be missing — the route
 * is registered under the path without it too — so requiring it here would
 * skip `load` on half of that route's own paths. */
const requiredParamNamesOf = (typePath: string) =>
	[...typePath.matchAll(PARAM_NAME_RE)]
		.filter((match) => match[2] === undefined)
		.map((match) => match[1])
		.filter((name): name is string => name !== undefined);

const hasRouteParams = <Path extends string>(
	context: FileRouteContext,
	names: readonly string[]
): context is FileRouteContext & { params: FileRouteParams<Path> } =>
	names.every((name) => typeof context.params[name] === 'string');

/* `Path` is inferred from the server module alone. It used to come from a
 * `path` field as well, which stopped working once the registered path and
 * the typed path became different strings for a catch-all or optional
 * route: inference saw `string` there and `Path` collapsed. */
type ServerHooks<Path extends string> = {
	server?: () => Promise<FileRouteServerModule<Path, unknown> | undefined>;
};

export const serverHooksOf = <Path extends string>(
	{ server }: ServerHooks<Path>,
	typePath: string
) => {
	if (!server) return {};
	const names = requiredParamNamesOf(typePath);
	const withParams = async <Result>(
		context: FileRouteContext,
		run: (
			module: FileRouteServerModule<Path, unknown>,
			typed: FileRouteContext<Path>
		) => Result
	) => {
		const module = await server();
		if (!module || !hasRouteParams<Path>(context, names)) return undefined;

		return run(module, context);
	};
	const hooks: Pick<FileRouteDefinition, 'beforeHandle' | 'load'> = {
		beforeHandle: (context) =>
			withParams(context, (module, typed) =>
				module.beforeHandle?.(typed)
			),
		load: (context) =>
			withParams(context, (module, typed) => module.load?.(typed))
	};

	return hooks;
};

type GuardLoader = () => Promise<FileRouteGuardModule | undefined>;
type BeforeHandle = NonNullable<FileRouteDefinition['beforeHandle']>;

/* Runs the folder guards in order and stops at the first that answers.
 * One at a time, never together: an outer guard that redirects an
 * anonymous visitor must do so before an inner one reads the session it
 * assumes is there. */
const runGuards = async (
	guards: readonly GuardLoader[],
	context: FileRouteContext,
	index = 0
): Promise<unknown> => {
	const load = guards[index];
	if (!load) return undefined;
	const answer = await (await load())?.beforeHandle?.(context);
	if (answer !== undefined) return answer;

	return runGuards(guards, context, index + 1);
};

/* A route's `beforeHandle` with its folders' guards in front of it:
 * `routes/layout.server.ts`, then `routes/admin/layout.server.ts`, then
 * the route's own. Absent entirely when the route has neither, so a
 * route with no guard registers no hook. */
const guardedBeforeHandle = (
	guards: readonly GuardLoader[] | undefined,
	own: BeforeHandle | undefined
) => {
	if (!guards || guards.length === 0) return own;
	const guarded: BeforeHandle = async (context) => {
		const answer = await runGuards(guards, context);
		if (answer !== undefined) return answer;

		return own?.(context);
	};

	return guarded;
};

/* `path` is the string Elysia registers, which is not always the path the
 * route's params are typed against: `/docs/[...rest]` types against
 * `/docs/:rest` and registers `/docs/*`. The type path reaches the adapters
 * as their explicit `Path` argument, through the `server` module's type, so
 * `path` here is a plain string. */
export type FileRouteAdapterInput = {
	name: string;
	path: string;
	source: string;
	/** The name the file gave its catch-all segment, for the runtime to
	 *  copy Elysia's `*` param onto. */
	catchAll?: string;
	/** The `layout.server.ts` module of each folder this route is in,
	 *  outermost first. Their `beforeHandle` runs before the route's. */
	guards?: readonly GuardLoader[];
	/** The path the route's types were written against, when it is not
	 *  `path`: `/docs/:rest` for a route registered as `/docs/*`. The
	 *  run-time params check reads its names, so it must be the typed one
	 *  — `*` is not a param name any `load` asks for. */
	typePath?: string;
};

export const defineFileRouteWith = <Path extends string>(
	framework: FileRouteFramework,
	route: FileRouteAdapterInput & {
		server?: () => Promise<
			FileRouteServerModule<Path, unknown> | undefined
		>;
	},
	render: (input: FileRouteRenderInput) => Promise<Response>
) => {
	const hooks = serverHooksOf(route, route.typePath ?? route.path);
	const beforeHandle = guardedBeforeHandle(route.guards, hooks.beforeHandle);
	const definition: FileRouteDefinition = {
		framework,
		name: route.name,
		path: route.path,
		render,
		source: route.source,
		...(route.catchAll === undefined ? {} : { catchAll: route.catchAll }),
		...hooks,
		...(beforeHandle === undefined ? {} : { beforeHandle })
	};

	return definition;
};
