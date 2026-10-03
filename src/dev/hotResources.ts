import { AsyncLocalStorage } from 'node:async_hooks';

/* What a top-level statement of a server module started, and stopping it
 * when that statement is replaced by a hot update (see docs/BACKEND_HMR.md).
 *
 * The hot runtime runs each top-level statement inside an owner context
 * (`module#statement` plus the module version). Everything created while the
 * context is active — including from its async work and from callbacks of
 * timers it created — is attributed to it: intervals, timeouts and timer
 * chains (cron libraries reschedule with `setTimeout`), immediates, `process`
 * listeners, extra servers, workers and `onHotDispose` callbacks.
 *
 * Work done while serving a request or a WebSocket event runs in a request
 * context and is never tracked: it belongs to that request, keeps running on
 * the code that started it and finishes on its own. */

export type ResourceKind =
	| 'dispose hook'
	| 'immediate'
	| 'interval'
	| 'listener'
	| 'server'
	| 'timeout'
	| 'worker';

type Resource = {
	kind: ResourceKind;
	owner: string;
	generation: number;
	dispose: () => unknown;
};

type HotContext =
	| {
			owner: string;
			generation: number;
			request?: undefined;
			untracked?: undefined;
	  }
	| { request: true; owner?: undefined; untracked?: undefined }
	| { untracked: true; owner?: undefined; request?: undefined };

type ServeOptions = Parameters<typeof Bun.serve>[0];

type TrackedServer = {
	owner: string;
	port: number;
	server: ReturnType<typeof Bun.serve>;
};

type HotResourceState = {
	installed: boolean;
	context: AsyncLocalStorage<HotContext>;
	resources: Set<Resource>;
	servers: Set<TrackedServer>;
};

declare global {
	var __absoluteHotResources: HotResourceState | undefined;
}

const state: HotResourceState = (globalThis.__absoluteHotResources ??= {
	context: new AsyncLocalStorage<HotContext>(),
	installed: false,
	resources: new Set(),
	servers: new Set()
});

const ownerContext = () => {
	const context = state.context.getStore();

	return context?.owner === undefined ? undefined : context;
};

const track = (kind: ResourceKind, dispose: () => unknown) => {
	const context = ownerContext();
	if (!context) return undefined;
	const resource: Resource = {
		dispose,
		generation: context.generation,
		kind,
		owner: context.owner
	};
	state.resources.add(resource);

	return resource;
};

/** The same callback, run as request work: nothing it starts is tracked. */
export const asRequest =
	<Args extends unknown[], Result>(callback: (...args: Args) => Result) =>
	(...args: Args) =>
		runAsRequest(() => callback(...args));
export const runAsRequest = <Result>(work: () => Result) =>
	state.context.run({ request: true }, work);
/** Run `work` as `owner` at `generation`: what it starts belongs to it. */
export const runOwned = <Result>(
	owner: string,
	generation: number,
	work: () => Result
) => state.context.run({ generation, owner }, work);
/** Run framework work no hot update may stop. */
export const runUntracked = <Result>(work: () => Result) =>
	state.context.run({ untracked: true }, work);

/** The same handler, run as request work (non-functions pass through). */
const requestHandler = (handler: unknown, thisArg?: unknown) =>
	typeof handler === 'function'
		? (...args: unknown[]) =>
				runAsRequest(() => Reflect.apply(handler, thisArg, args))
		: handler;

const installTimers = () => {
	const realSetTimeout = globalThis.setTimeout;
	const realSetInterval = globalThis.setInterval;
	const realSetImmediate = globalThis.setImmediate;
	const realClearTimeout = globalThis.clearTimeout;
	const realClearInterval = globalThis.clearInterval;
	const realClearImmediate = globalThis.clearImmediate;
	const byHandle = new Map<unknown, Resource>();
	const forget = (handle: unknown) => {
		const resource = byHandle.get(handle);
		if (!resource) return;
		byHandle.delete(handle);
		state.resources.delete(resource);
	};
	const schedule = <Handle>(
		kind: 'immediate' | 'interval' | 'timeout',
		start: (callback: (...args: unknown[]) => void) => Handle,
		clear: (handle: Handle) => void,
		callback: unknown
	) => {
		const context = ownerContext();
		if (!context || typeof callback !== 'function')
			return start((...args) => {
				if (typeof callback === 'function') callback(...args);
			});
		// The callback keeps its owner, so a timer chain stays attributed.
		const run = (...args: unknown[]) =>
			runOwned(context.owner, context.generation, () => {
				if (kind !== 'interval') forget(handle);
				callback(...args);
			});
		const handle = start(run);
		const resource = track(kind, () => {
			byHandle.delete(handle);
			if (handle !== undefined) clear(handle);
		});
		if (resource) byHandle.set(handle, resource);

		return handle;
	};

	globalThis.setTimeout = Object.assign(
		(callback: unknown, delay?: number, ...args: unknown[]) =>
			schedule(
				'timeout',
				(run) => realSetTimeout(run, delay, ...args),
				realClearTimeout,
				callback
			),
		realSetTimeout
	);
	globalThis.setInterval = Object.assign(
		(callback: unknown, delay?: number, ...args: unknown[]) =>
			schedule(
				'interval',
				(run) => realSetInterval(run, delay, ...args),
				realClearInterval,
				callback
			),
		realSetInterval
	);
	globalThis.setImmediate = Object.assign(
		(callback: unknown, ...args: unknown[]) =>
			schedule(
				'immediate',
				(run) => realSetImmediate(run, ...args),
				realClearImmediate,
				callback
			),
		realSetImmediate
	);
	globalThis.clearTimeout = Object.assign(
		(handle?: Parameters<typeof clearTimeout>[0]) => {
			forget(handle);
			realClearTimeout(handle);
		},
		realClearTimeout
	);
	globalThis.clearInterval = Object.assign(
		(handle?: Parameters<typeof clearInterval>[0]) => {
			forget(handle);
			realClearInterval(handle);
		},
		realClearInterval
	);
	globalThis.clearImmediate = Object.assign(
		(handle?: Parameters<typeof clearImmediate>[0]) => {
			forget(handle);
			realClearImmediate(handle);
		},
		realClearImmediate
	);
};

const installProcessListeners = () => {
	const methods: Array<'addListener' | 'on' | 'once' | 'prependListener'> = [
		'on',
		'addListener',
		'once',
		'prependListener'
	];
	for (const method of methods) {
		const real = Reflect.get(process, method);
		if (typeof real !== 'function') continue;
		const patched = (
			event: string | symbol,
			listener: (...args: unknown[]) => void
		) => {
			Reflect.apply(real, process, [event, listener]);
			track('listener', () => process.removeListener(event, listener));

			return process;
		};
		Reflect.set(process, method, patched);
	}
};

const wrapRoute = (route: unknown) => {
	if (typeof route === 'function') return requestHandler(route);
	if (!route || typeof route !== 'object' || route instanceof Response)
		return route;

	return Object.fromEntries(
		Object.entries(route).map(([method, handler]) => [
			method,
			requestHandler(handler)
		])
	);
};

const wrapRoutes = (routes: object) =>
	Object.fromEntries(
		Object.entries(routes).map(([path, route]) => [path, wrapRoute(route)])
	);

const wrapSocketHandlers = (socket: object) => {
	const wrapped: Record<string, unknown> = { ...socket };
	for (const event of ['open', 'message', 'close', 'drain', 'ping', 'pong']) {
		const handler = Reflect.get(socket, event);
		if (typeof handler === 'function')
			wrapped[event] = requestHandler(handler, socket);
	}

	return wrapped;
};

/** The same serve options with every request, route and WebSocket handler
 *  running as request work. */
export const wrapServeOptions = <Options extends object>(options: Options) => {
	const wrapped: Options = { ...options };
	const fetch = Reflect.get(options, 'fetch');
	if (typeof fetch === 'function')
		Reflect.set(wrapped, 'fetch', requestHandler(fetch, options));
	const socket = Reflect.get(options, 'websocket');
	if (socket && typeof socket === 'object')
		Reflect.set(wrapped, 'websocket', wrapSocketHandlers(socket));
	const routes = Reflect.get(options, 'routes');
	if (routes && typeof routes === 'object')
		Reflect.set(wrapped, 'routes', wrapRoutes(routes));

	return wrapped;
};

const installServers = () => {
	const realServe = Bun.serve.bind(Bun);
	const patched = (options: ServeOptions) => {
		const context = ownerContext();
		const requestedPort = Number(Reflect.get(options, 'port') ?? 0);
		// A statement that serves on a fixed port re-runs while its previous
		// server still holds the port: hand the port over.
		if (context && requestedPort > 0)
			for (const entry of state.servers) {
				if (
					entry.owner !== context.owner ||
					entry.port !== requestedPort
				)
					continue;
				entry.server.stop(true);
				state.servers.delete(entry);
			}
		const server = realServe(wrapServeOptions(options));
		if (context) {
			const entry: TrackedServer = {
				owner: context.owner,
				port: server.port ?? requestedPort,
				server
			};
			state.servers.add(entry);
			track('server', () => {
				state.servers.delete(entry);
				server.stop(true);
			});
		}

		return server;
	};
	Reflect.set(Bun, 'serve', patched);
};

const installWorkers = () => {
	const RealWorker = globalThis.Worker;
	if (typeof RealWorker !== 'function') return;
	class TrackedWorker extends RealWorker {
		constructor(...args: ConstructorParameters<typeof Worker>) {
			super(...args);
			track('worker', () => this.terminate());
		}
	}
	globalThis.Worker = TrackedWorker;
};

/** Start attributing what top-level statements create. Dev only; safe to
 *  call more than once. */
export const installHotResources = () => {
	if (state.installed) return;
	state.installed = true;
	installTimers();
	installProcessListeners();
	installServers();
	installWorkers();
};

export type DisposedCounts = Partial<Record<ResourceKind, number>>;

const stopResource = async (resource: Resource, counts: DisposedCounts) => {
	state.resources.delete(resource);
	counts[resource.kind] = (counts[resource.kind] ?? 0) + 1;
	try {
		await resource.dispose();
	} catch (error) {
		console.error(
			`[hmr] stopping a ${resource.kind} from ${resource.owner} failed:`,
			error
		);
	}
};

/** Stop the resources `select` picks. Dispose hooks run last, after the
 *  timers and servers they might depend on are gone. */
export const disposeResources = async (
	select: (owner: string, generation: number) => boolean
) => {
	const counts: DisposedCounts = {};
	const chosen = [...state.resources].filter((resource) =>
		select(resource.owner, resource.generation)
	);
	const ordered = [
		...chosen.filter((resource) => resource.kind !== 'dispose hook'),
		...chosen.filter((resource) => resource.kind === 'dispose hook')
	];
	// Sequential: a dispose hook may close something another one relies on.
	await ordered.reduce<Promise<void>>(
		(previous, resource) =>
			previous.then(() => stopResource(resource, counts)),
		Promise.resolve()
	);

	return counts;
};

/** Register cleanup for when the top-level statement that registered it is
 *  replaced by a hot update: close a pool, stop a subscription, release a
 *  lock. No-op outside development or outside a top-level statement. */
export const onHotDispose = (dispose: () => unknown) => {
	track('dispose hook', dispose);
};
