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
 * separate bundles (see `bootLifecycle.ts`). */

import type { Server } from 'bun';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { getBootPhase } from './bootLifecycle';

const HTTP_SERVICE_UNAVAILABLE = 503;
const RETRY_AFTER_SECONDS = 2;
const BIND_RETRY_INTERVAL_MS = 250;
const BIND_RETRY_LIMIT = 40;
const POLL_INTERVAL_MS = RETRY_AFTER_SECONDS * MILLISECONDS_IN_A_SECOND;
const NOSCRIPT_REFRESH_SECONDS = 10;

export const BOOT_STATUS_HEADER = 'X-Absolute-Boot';

// True while the placeholder itself is inside `Bun.serve`, so the
// defensive serve guard does not mistake that bind for the real server.
let bindingPlaceholder = false;

export type EarlyListenerOptions = {
	host: string;
	port: number;
	tls?: { cert: string; key: string } | null;
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
export const releaseEarlyListener = () => {
	const listener = globalThis.__absoluteEarlyListener;
	if (!listener) return false;
	const hadServer = listener.server !== null;
	listener.release();
	globalThis.__absoluteEarlyListener = undefined;

	return hadServer;
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
