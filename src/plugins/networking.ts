import { argv } from 'node:process';
import { env } from 'bun';
import { type AnyElysia } from 'elysia';
import { websocket } from 'elysia/websocket';
import { buildGlobalWSHandler } from 'elysia/ws';
import {
	DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS,
	DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
	DEFAULT_PORT,
	MAX_HTTP_IDLE_TIMEOUT_SECONDS,
	MILLISECONDS_IN_A_SECOND
} from '../constants';
import { runDeferredBootTasks } from '../dev/bootLifecycle';
import { loadDevCert } from '../dev/devCert';
import { releaseEarlyListener } from '../dev/earlyListener';
import {
	registerInstance,
	resolveProjectName
} from '../utils/instanceRegistry';
import { getLocalIPAddress } from '../utils/networking';
import { startupBanner } from '../utils/startupBanner';
import { logBootTimeline, markBoot } from '../utils/bootTimeline';

// Env-var precedence: ABSOLUTE_HOST/ABSOLUTE_PORT (set by `bun dev` after
// resolving config-file values + Vite-style port fallback) → legacy
// HOST/PORT → defaults.
let host = env.ABSOLUTE_HOST ?? env.HOST ?? 'localhost';
const port = env.ABSOLUTE_PORT ?? env.PORT ?? DEFAULT_PORT;
const visibility = env.ABSOLUTE_WORKSPACE_SERVICE_VISIBILITY ?? 'public';
const managedByWorkspace = env.ABSOLUTE_WORKSPACE_MANAGED === '1';
let localIP: string | undefined;

const args = argv;
const hostFlag = args.includes('--host');

if (hostFlag) {
	host = '0.0.0.0';
}
if (host === '0.0.0.0' || host === '::') localIP = getLocalIPAddress();

// TLS is enabled via ABSOLUTE_HTTPS env var set by the config loader
const loadTls = () => {
	if (env.NODE_ENV !== 'development') return undefined;
	if (env.ABSOLUTE_HTTPS !== 'true') return undefined;

	try {
		return loadDevCert();
	} catch {
		return undefined;
	}
};
const tls = loadTls();
const protocol = tls ? 'https' : 'http';
// Resolve the HTTP idleTimeout (seconds) passed to Bun.serve. Bun's default is
// 10s, which silently reaps long-lived/streaming responses (SSE, AI turns, long
// polls). We default high (DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS) and let a consumer
// override via ABSOLUTE_IDLE_TIMEOUT. 0 is honored as "disable the timeout";
// other values clamp to Bun's [1, 255] range so an out-of-range config can't
// throw at listen() time.
const resolveHttpIdleTimeout = () => {
	const raw = env.ABSOLUTE_IDLE_TIMEOUT;
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS;
	}
	if (parsed === 0) return 0;

	return Math.min(
		Math.max(Math.round(parsed), 1),
		MAX_HTTP_IDLE_TIMEOUT_SECONDS
	);
};
const httpIdleTimeout = resolveHttpIdleTimeout();

// Publish this server to the global instance registry so `absolute ps` can see
// it. Skipped when an outer `absolute` CLI/orchestrator already owns the entry
// (ABSOLUTE_INSTANCE_MANAGED) — this branch is the catch-all for servers
// started outside the CLI: a manually-run `bun server.ts` or any standalone
// process. registerInstance handles its own exit cleanup.
const selfRegisterInstance = () => {
	if (env.ABSOLUTE_INSTANCE_MANAGED === '1') return;

	registerInstance({
		command: [...process.argv],
		configPath: env.ABSOLUTE_CONFIG ?? null,
		controllerPid: process.pid,
		cwd: process.cwd(),
		frameworks: [],
		host,
		https: protocol === 'https',
		logFile: null,
		name: resolveProjectName(process.cwd()),
		pid: process.pid,
		port: Number(port) || null,
		ppid: process.ppid,
		source: 'standalone',
		startedAt: new Date().toISOString()
	});
};

// `AnyElysia` (not the base `Elysia`) as the bound: this wrapper accepts ANY
// app shape and returns it unchanged (`A`), so a large app's accumulated
// context (e.g. auth's `protectRoute` derive) does not have to satisfy the
// empty base singleton — checking that against a big chain trips TS2589 at the
// call site. The bound is what's widened, never the return.
export const networking = <A extends AnyElysia>(app: A) => {
	if (env.ABSOLUTE_COMPILED_RUNTIME === '1') return app;

	app.use(
		websocket({
			idleTimeout: DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
			sendPings: true
		})
	);

	// Dev-only route introspection for `absolute routes` — reads the live route
	// table at request time. (The request inspector for `absolute inspect` is
	// mounted first inside the `absolutejs` runtime in prepare(), since its
	// global hooks must precede the routes they observe.) Never exposed in prod.
	if (env.NODE_ENV === 'development') {
		app.get('/__absolute/routes', () =>
			app.routes.map((route) => ({
				method: route.method,
				path: route.path
			}))
		);
	}

	// Path B (in-place backend HMR): if a previous evaluation of this
	// entry already started a Bun.serve, swap its handler in place
	// instead of re-binding the port. The new Elysia instance becomes
	// the live handler atomically; the listening socket persists, so
	// in-flight requests, WebSocket sessions, DB pools, and module-
	// level globals carry across edits.
	//
	// Activation: the dev runtime sets `globalThis.__absoluteBunServer`
	// after the first `app.listen(...)` call; it triggers re-evaluation
	// of the entry via cache-busted dynamic import on file change.
	// Outside dev, this branch never runs (the global is unset).
	const liveServer = globalThis.__absoluteBunServer;
	if (liveServer && typeof liveServer.reload === 'function') {
		// Elysia 2 removed the public app.store getter. The dev HMR plugin
		// restores the composed request-context store on the first request
		// through the newly imported app instead.
		try {
			app.compile();
		} catch {
			/* compile is best-effort; some Elysia configs skip it */
		}
		// Elysia compiles routes into Bun.serve's `routes` static map
		// at .listen() time for performance. `Bun.serve.reload({fetch})`
		// only swaps the fetch fallback — the OLD static `routes` map
		// keeps serving original handlers. Clear it on reload so every
		// request falls through to our new app's fetch.
		//
		// Re-pass `websocket` too, mirroring what Elysia's own BunAdapter
		// reload does (it spreads the full serve config). Elysia's handler is
		// a stateless singleton that dispatches via `ws.data`, but the new
		// framework keepalive defaults are applied to this persistent Bun server.
		//
		// Critically, wire the live Bun server onto the new app instance. A WS
		// upgrade runs through `app.fetch`, where Elysia does
		// `(context.server ?? app.server).upgrade(request, …)`. Path B never
		// calls `.listen()` on the new instance, so its `app.server` is null —
		// the upgrade is skipped and every `.ws()` route 400s after the first
		// hot reload (the symptom that read as "voice doesn't work in dev").
		// Pointing `app.server` at the persisted socket restores upgrades.
		app.server = liveServer;
		liveServer.reload({
			routes: {},
			websocket: {
				idleTimeout: DEFAULT_WEBSOCKET_IDLE_TIMEOUT_SECONDS,
				sendPings: true,
				...buildGlobalWSHandler()
			},
			fetch: (request: Request) => app.fetch(request)
		});
		runDeferredBootTasks();

		return app;
	}

	// Hand the port over from the dev bootstrap's "Building…" placeholder
	// (see `dev/earlyListener.ts`). `stop(true)` closes its listen socket
	// synchronously, so the real bind below cannot see EADDRINUSE from it.
	releaseEarlyListener();

	markBoot('listen() called');
	const listened = app.listen(
		{
			hostname: host,
			idleTimeout: httpIdleTimeout,
			port: port,
			...(tls
				? {
						tls: {
							cert: tls.cert,
							key: tls.key
						}
					}
				: {})
		},
		() => {
			markBoot('server listening');
			selfRegisterInstance();
			// The port is serving real traffic now — flush boot work that
			// was deferred off the critical path (module prewarm, etc.).
			runDeferredBootTasks();

			if (visibility === 'internal' || managedByWorkspace) {
				return;
			}

			// Skip logging on Bun --hot reloads (HMR handles its own output)
			const isHotReload = Boolean(globalThis.__hmrServerStartup);
			globalThis.__hmrServerStartup = true;
			if (isHotReload) {
				return;
			}

			const buildDuration =
				globalThis.__hmrBuildDuration ??
				Number(env.ABSOLUTE_BUILD_DURATION || 0);
			const readyDuration = process.uptime() * MILLISECONDS_IN_A_SECOND;

			const version =
				globalThis.__absoluteVersion || env.ABSOLUTE_VERSION || '';

			startupBanner({
				buildDuration,
				host,
				mobilePreviewUrl:
					env.ABSOLUTE_MOBILE_PREVIEW === '1'
						? `${protocol}://${host === '0.0.0.0' ? 'localhost' : host}:${port}/__absolute/mobile-preview`
						: undefined,
				networkUrl: hostFlag
					? `${protocol}://${localIP}:${port}/`
					: undefined,
				port,
				protocol,
				readyDuration,
				version
			});
			markBoot('ready banner printed');
			logBootTimeline();
		}
	);

	// Capture the underlying Bun.serve instance synchronously after
	// `.listen()` returns. Elysia sets `app.server = Bun.serve(...)`
	// inline, so the assignment is observable here without waiting for
	// any lifecycle hook. Subsequent re-evaluations of the entry hit
	// the reload-aware branch above and never reach this point.
	if (app.server) {
		globalThis.__absoluteBunServer = app.server;
		// Path B: start the entry-file watcher now that the server is
		// bound. The watcher triggers cache-busted dynamic re-imports
		// on entry edits, which hit the reload-aware branch instead of
		// re-binding. Only runs in dev mode (compiled runtime returned
		// early at the top).
		if (env.NODE_ENV === 'development') {
			void import('../dev/serverEntryWatcher')
				.then(({ startServerEntryWatcher }) =>
					startServerEntryWatcher()
				)
				.catch((err) => {
					/* dev-only feature; never break the server */
					console.error(
						`[hmr] entry watcher setup failed: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				});
		}
	}

	return listened;
};
