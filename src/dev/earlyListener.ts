/* Early dev listener.
 *
 * `absolute dev` used to leave the port closed until the user's entry
 * finished `await prepare()` (the whole boot build) and called
 * `.listen()`. On a large app that is 30-60s of connection-refused, which
 * a hosted preview renders as a blank frame. The dev bootstrap now binds
 * a placeholder `Bun.serve` on the resolved port BEFORE importing the
 * entry, and answers every request with `503 Retry-After: 2` plus a tiny
 * self-refreshing "Building…" page. The `networking` plugin releases the
 * placeholder immediately before the real `app.listen()`, so the real
 * server binds the same port without EADDRINUSE (`server.stop(true)`
 * closes the listen socket synchronously) and `strictPort` semantics are
 * untouched — the CLI probed the port before spawning us, and the real
 * listen still fails loudly if something else grabs it in between.
 *
 * Lives on `globalThis` because the bootstrap and the runtime are
 * separate bundles (see `bootLifecycle.ts`).
 *
 * Binding early stopped "connection refused" but did NOT make the port
 * responsive: the child is a single JS thread, and while it synchronously
 * evaluates the user's module graph it cannot run this handler. On a large
 * app the socket exists at ~0.6s and the first byte still arrives at ~4.5s.
 * So the CLI parent — a separate process whose event loop is free — binds
 * the same placeholder first (`parent listener bound` in the boot
 * timeline) and hands the port to the child. The hand-off rides
 * `SO_REUSEPORT`: parent and child are briefly bound at the same time, so
 * there is never an instant with no listener, and the parent closes as
 * soon as the child signals that the real server is up. Everything below
 * that mentions "parent" belongs to that path; the placeholder itself is
 * unchanged and stays the fallback for when the parent cannot bind. */

import type { Server } from 'bun';
import { writeSync } from 'node:fs';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { getBootPhase } from './bootLifecycle';

const HTTP_SERVICE_UNAVAILABLE = 503;
const RETRY_AFTER_SECONDS = 2;
const BIND_RETRY_INTERVAL_MS = 250;
const BIND_RETRY_LIMIT = 40;
const POLL_INTERVAL_MS = RETRY_AFTER_SECONDS * MILLISECONDS_IN_A_SECOND;
const NOSCRIPT_REFRESH_SECONDS = 10;

export const BOOT_STATUS_HEADER = 'X-Absolute-Boot';

/** Written by the child on fd 3 the instant the real server is bound, so
 *  the CLI can close its placeholder. A dedicated pipe rather than stdout:
 *  the marker must never reach the developer's terminal or the instance
 *  log, and stdout chunks coalesce in ways that make stripping a line out
 *  of the forwarded stream unreliable. */
export const PARENT_HANDOFF_MARKER = 'absolute:listening';

/** Set on the child by the CLI when the CLI itself holds the placeholder
 *  on the dev port. The child then skips its own placeholder and binds the
 *  real server with `reusePort` so the two can overlap. */
export const PARENT_LISTENER_ENV = 'ABSOLUTE_PARENT_LISTENER';

const PARENT_HANDOFF_FD = 3;

// True while the placeholder itself is inside `Bun.serve`, so the
// defensive serve guard does not mistake that bind for the real server.
let bindingPlaceholder = false;

export type EarlyListenerOptions = {
	host: string;
	port: number;
	tls?: { cert: string; key: string } | null;
	/** Bind with `SO_REUSEPORT` so the child's real server can bind the
	 *  same port before this placeholder goes away. Only the CLI parent
	 *  sets it. */
	reusePort?: boolean;
};

export type EarlyListener = {
	/** The placeholder server, or null while a bind retry is pending or
	 *  after release. */
	readonly server: Server<undefined> | null;
	readonly startedAt: number;
	readonly released: boolean;
	release: () => void;
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

export const bootStatusSnapshot = (startedAt: number) => {
	const elapsedMs = Math.max(0, Date.now() - startedAt);

	return {
		elapsedMs,
		elapsedSeconds: Math.floor(elapsedMs / MILLISECONDS_IN_A_SECOND),
		phase: getBootPhase() ?? 'starting',
		status: 'building' as const
	};
};

const buildingPage = (snapshot: ReturnType<typeof bootStatusSnapshot>) =>
	`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${NOSCRIPT_REFRESH_SECONDS}">
<title>Building…</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1115;color:#e6e8ee}
main{text-align:center;padding:2rem}
.spin{width:36px;height:36px;margin:0 auto 1rem;border:3px solid rgba(255,255,255,.15);border-top-color:#8ab4ff;border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
h1{font-size:1.15rem;font-weight:600;margin:0 0 .25rem}
p{margin:0;opacity:.6;font-size:.85rem}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
</style>
</head>
<body>
<main>
<div class="spin" aria-hidden="true"></div>
<h1>Building… <span id="t">${snapshot.elapsedSeconds}</span>s</h1>
<p>AbsoluteJS dev server · <code id="p">${escapeHtml(snapshot.phase)}</code></p>
</main>
<script>
(function(){
var started=Date.now()-${snapshot.elapsedMs};
var t=document.getElementById('t');
setInterval(function(){t.textContent=String(Math.floor((Date.now()-started)/1000));},1000);
function poll(){
fetch(location.href,{cache:'no-store',headers:{accept:'application/json'}}).then(function(r){
if(r.headers.get('${BOOT_STATUS_HEADER.toLowerCase()}')!=='building'){location.reload();return;}
return r.json().then(function(j){if(j&&j.phase){document.getElementById('p').textContent=j.phase;}});
}).catch(function(){}).then(function(){setTimeout(poll,${POLL_INTERVAL_MS});});
}
setTimeout(poll,${POLL_INTERVAL_MS});
})();
</script>
</body>
</html>
`;

/** 503 response for one request while the boot build is still running.
 *  HTML for browsers (`Accept: text/html`), JSON for JSON clients, plain
 *  text otherwise; WebSocket upgrade attempts (the HMR client) get a plain
 *  503 instead of an upgrade so they fail the handshake cleanly and fall
 *  back to their `/hmr-status` polling loop. */
export const buildingResponse = (request: Request, startedAt: number) => {
	const snapshot = bootStatusSnapshot(startedAt);
	const headers: Record<string, string> = {
		'Cache-Control': 'no-store',
		'Retry-After': String(RETRY_AFTER_SECONDS),
		'X-Absolute-Boot': 'building'
	};
	const isUpgrade =
		request.headers.get('upgrade')?.toLowerCase() === 'websocket';
	const accept = request.headers.get('accept') ?? '';
	if (!isUpgrade && accept.includes('text/html')) {
		headers['Content-Type'] = 'text/html; charset=utf-8';

		return new Response(buildingPage(snapshot), {
			headers,
			status: HTTP_SERVICE_UNAVAILABLE
		});
	}
	if (!isUpgrade && accept.includes('application/json')) {
		headers['Content-Type'] = 'application/json; charset=utf-8';

		return new Response(JSON.stringify(snapshot), {
			headers,
			status: HTTP_SERVICE_UNAVAILABLE
		});
	}
	headers['Content-Type'] = 'text/plain; charset=utf-8';

	return new Response(
		`AbsoluteJS dev server is building (${snapshot.elapsedSeconds}s, ${snapshot.phase}). Retry shortly.\n`,
		{ headers, status: HTTP_SERVICE_UNAVAILABLE }
	);
};
/** Defensive hand-off for entries that call `.listen()` without the
 *  `networking` plugin: any `Bun.serve` that targets the placeholder's
 *  port first releases it. Installed once per process by the bootstrap. */
export const installEarlyListenerServeGuard = (port: number) => {
	if (globalThis.__absoluteEarlyListenerServeGuard) return;
	const originalServe = Bun.serve;
	const guardedServe = (serveOptions: Parameters<typeof Bun.serve>[0]) => {
		const requested = Number(serveOptions.port ?? port);
		const listener = globalThis.__absoluteEarlyListener;
		if (
			!bindingPlaceholder &&
			listener &&
			(requested === port || Number.isNaN(requested))
		) {
			releaseEarlyListener();
		}

		return originalServe.call(Bun, serveOptions);
	};
	// `Reflect.set` rather than assignment: the property may be read-only
	// in some runtimes, and then `networking` still releases the
	// placeholder on the documented path.
	if (Reflect.set(Bun, 'serve', guardedServe)) {
		globalThis.__absoluteEarlyListenerServeGuard = true;
	}
};
/** Defensive hand-off for the parent-owned path: any `Bun.serve` that
 *  targets the dev port is bound with `reusePort` (so it can come up while
 *  the CLI's placeholder is still listening) and reports the bind back to
 *  the CLI. The `networking` plugin does both explicitly; this guard is
 *  what makes entries that call `.listen()` without it work too, mirroring
 *  `installEarlyListenerServeGuard` on the child-owned path. */
export const installParentPortHandoffGuard = (port: number) => {
	if (globalThis.__absoluteParentPortHandoffGuard) return;
	const originalServe = Bun.serve;
	const guardedServe = (serveOptions: Parameters<typeof Bun.serve>[0]) => {
		if (Number(serveOptions.port) !== port) {
			return originalServe.call(Bun, serveOptions);
		}
		// Mutated rather than spread: `Bun.serve`'s options are a union of
		// mutually exclusive shapes (unix vs hostname/port, fetch vs
		// routes), and spreading collapses them into something assignable
		// to none of them. Elysia builds a fresh literal for every
		// `.listen()`, so nothing else observes this object.
		Reflect.set(serveOptions, 'reusePort', true);
		const server = originalServe.call(Bun, serveOptions);
		signalParentPortHandoff(port);

		return server;
	};
	if (Reflect.set(Bun, 'serve', guardedServe)) {
		globalThis.__absoluteParentPortHandoffGuard = true;
	}
};
/** `SO_REUSEPORT` is POSIX-only; Windows has no equivalent that lets two
 *  processes share a listening socket, so the parent-side placeholder is
 *  not offered there and the child's own placeholder stays in charge. */
export const parentListenerSupported = () => process.platform !== 'win32';
/** True when the CLI parent, not this process, owns the placeholder. */
export const parentOwnsDevPort = () => process.env[PARENT_LISTENER_ENV] === '1';
export const releaseEarlyListener = () => {
	const listener = globalThis.__absoluteEarlyListener;
	if (!listener) return false;
	const hadServer = listener.server !== null;
	listener.release();
	globalThis.__absoluteEarlyListener = undefined;

	return hadServer;
};
/** Tell the CLI parent that the real server is bound, so it can close its
 *  placeholder. Idempotent, and silent when there is no hand-off pipe (the
 *  bootstrap run directly, or a parent that never bound) — the CLI also
 *  releases on the ready banner, so a missed signal is not fatal. */
export const signalParentPortHandoff = (port: number) => {
	if (globalThis.__absoluteParentHandoffSignalled) return;
	globalThis.__absoluteParentHandoffSignalled = true;
	try {
		writeSync(PARENT_HANDOFF_FD, `${PARENT_HANDOFF_MARKER} ${port}\n`);
	} catch {
		/* no hand-off pipe on fd 3 */
	}
};
/** Bind the placeholder. A failed bind (the previous child's socket is
 *  still draining, or the port genuinely conflicts) is retried in the
 *  background for a few seconds and then given up on silently — the real
 *  `.listen()` still reports the conflict the way it always did. Never
 *  throws: the placeholder is a nicety and must not break boot. */
export const startEarlyListener = (options: EarlyListenerOptions) => {
	const startedAt = Date.now();
	let server: Server<undefined> | null = null;
	let released = false;
	let attempts = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;

	const tryBind = () => {
		if (released) return;
		attempts += 1;
		// Flagged so the `Bun.serve` guard below ignores our own bind.
		bindingPlaceholder = true;
		try {
			server = Bun.serve({
				hostname: options.host,
				port: options.port,
				fetch: (request) => buildingResponse(request, startedAt),
				...(options.reusePort ? { reusePort: true } : {}),
				...(options.tls ? { tls: options.tls } : {})
			});
		} catch {
			if (attempts >= BIND_RETRY_LIMIT) return;
			retryTimer = setTimeout(tryBind, BIND_RETRY_INTERVAL_MS);
			retryTimer.unref();
		} finally {
			bindingPlaceholder = false;
		}
	};

	const release = () => {
		if (released) return;
		released = true;
		if (retryTimer) clearTimeout(retryTimer);
		const active = server;
		server = null;
		if (!active) return;
		try {
			// `true` closes active keep-alive connections too, so the
			// listen socket is free the moment this returns.
			void active.stop(true);
		} catch {
			/* already stopped */
		}
	};

	tryBind();

	const listener: EarlyListener = {
		release,
		startedAt,
		get released() {
			return released;
		},
		get server() {
			return server;
		}
	};
	globalThis.__absoluteEarlyListener = listener;

	return listener;
};
