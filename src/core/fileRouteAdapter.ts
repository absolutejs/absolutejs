import type {
	FileRouteContext,
	FileRouteDefinition,
	FileRouteFramework,
	FileRouteParams,
	FileRouteRenderInput,
	FileRouteServerModule
} from '../../types/fileRoutes';

/* Shared by the framework adapters (`reactFileRoute`, `svelteFileRoute`):
 * turns a route's lazily imported server module into the framework-neutral
 * hooks `fileRoutes()` runs. The adapters' generics check, at compile time,
 * that the module's `load` takes this route's params and returns the page's
 * props; at run time the request's params are checked against the path. */

const PARAM_NAME_RE = /:([A-Za-z_$][\w$]*)/g;

const paramNamesOf = (path: string) =>
	[...path.matchAll(PARAM_NAME_RE)]
		.map((match) => match[1])
		.filter((name): name is string => name !== undefined);

const hasRouteParams = <Path extends string>(
	context: FileRouteContext,
	names: readonly string[]
): context is FileRouteContext & { params: FileRouteParams<Path> } =>
	names.every((name) => typeof context.params[name] === 'string');

type ServerHooks<Path extends string> = {
	path: Path;
	server?: () => Promise<FileRouteServerModule<Path, unknown> | undefined>;
};

export const serverHooksOf = <Path extends string>({
	path,
	server
}: ServerHooks<Path>) => {
	if (!server) return {};
	const names = paramNamesOf(path);
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

export type FileRouteAdapterInput<Path extends string> = {
	name: string;
	path: Path;
	source: string;
};

export const defineFileRouteWith = <Path extends string>(
	framework: FileRouteFramework,
	route: FileRouteAdapterInput<Path> & {
		server?: () => Promise<
			FileRouteServerModule<Path, unknown> | undefined
		>;
	},
	render: (input: FileRouteRenderInput) => Promise<Response>
) => {
	const definition: FileRouteDefinition = {
		framework,
		name: route.name,
		path: route.path,
		render,
		source: route.source,
		...serverHooksOf(route)
	};

	return definition;
};
