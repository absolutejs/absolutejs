/* AbsoluteJS HMR Client - Entry point
   Initializes WebSocket connection, dispatches messages to framework handlers */

import { hmrState } from './hmrState';
import {
	HMR_UPDATE_TIMEOUT_MS,
	MAX_RECONNECT_ATTEMPTS,
	PING_INTERVAL_MS,
	RECONNECT_INITIAL_DELAY_MS,
	RECONNECT_POLL_INTERVAL_MS,
	WEBSOCKET_NORMAL_CLOSURE
} from './constants';
import { detectCurrentFramework } from './frameworkDetect';
import {
	absoluteHmrClientTarget,
	restoreAbsoluteHmrApply,
	sendAbsoluteHmrTiming
} from './hmrTiming';
import { hideErrorOverlay, showErrorOverlay } from './errorOverlay';
import { installAbsoluteNativeSyncDevtools } from './syncDevtools';
import {
	dispatchAngularComponentRemount,
	dispatchAngularComponentUpdate
} from './handlers/angularHmrShim';
import { installAngularRemountGlobal } from './handlers/angularRemountWiring';
import { handleReactUpdate } from './handlers/react';
import { handleHTMLUpdate, handleScriptUpdate } from './handlers/html';
import { handleHTMXUpdate } from './handlers/htmx';
import { handleSvelteUpdate } from './handlers/svelte';
import { handleVueUpdate } from './handlers/vue';
import { reloadCSSStylesheets } from './cssUtils';
import {
	handleFullReload,
	handleManifest,
	handleModuleUpdate,
	handleRebuildComplete,
	handleRebuildError
} from './handlers/rebuild';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isStringRecord = (value: unknown): value is Record<string, string> =>
	isRecord(value) &&
	Object.values(value).every((entry) => typeof entry === 'string');

restoreAbsoluteHmrApply();
const removeNativeSyncDevtools =
	absoluteHmrClientTarget() === 'web'
		? () => undefined
		: installAbsoluteNativeSyncDevtools();

/* Lightweight "server disconnected" banner. When the dev server is
 * genuinely down (process restarting or crashed) the browser would
 * otherwise show its own blank "site can't be reached" page — this keeps
 * a branded, self-explanatory notice on screen while the client polls
 * `/hmr-status` and reloads on recovery. Kept separate from the compile
 * error overlay so it never clobbers a build-error message. The
 * `data-hmr-overlay` attribute exempts it from HMR DOM diffing. */
const CONNECTION_LOST_BANNER_ID = 'absolutejs-connection-lost';
const showConnectionLostBanner = () => {
	if (typeof document === 'undefined' || !document.body) return;
	if (document.getElementById(CONNECTION_LOST_BANNER_ID)) return;
	const banner = document.createElement('div');
	banner.id = CONNECTION_LOST_BANNER_ID;
	banner.setAttribute('data-hmr-overlay', 'true');
	banner.style.cssText = [
		'position:fixed',
		'left:0',
		'right:0',
		'bottom:0',
		'z-index:2147483646',
		'padding:10px 16px',
		'font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
		'color:#fff',
		'background:#b91c1c',
		'text-align:center',
		'box-shadow:0 -2px 12px rgba(0,0,0,0.3)'
	].join(';');
	banner.textContent = 'AbsoluteJS · dev server disconnected — reconnecting…';
	document.body.appendChild(banner);
};
const hideConnectionLostBanner = () => {
	if (typeof document === 'undefined') return;
	const banner = document.getElementById(CONNECTION_LOST_BANNER_ID);
	if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
};

// Initialize HMR globals
if (typeof window !== 'undefined') {
	window.__ABS_HMR_TARGET__ = absoluteHmrClientTarget();
	installAngularRemountGlobal();
	if (!window.__HMR_MANIFEST__) {
		window.__HMR_MANIFEST__ = {};
	}
	if (!window.__HMR_MODULE_UPDATES__) {
		window.__HMR_MODULE_UPDATES__ = [];
	}
	if (!window.__HMR_MODULE_VERSIONS__) {
		window.__HMR_MODULE_VERSIONS__ = {};
	}
	if (!window.__HMR_SERVER_VERSIONS__) {
		window.__HMR_SERVER_VERSIONS__ = {};
	}
}

// Catch uncaught runtime errors and show the error overlay
window.addEventListener('error', (evt) => {
	if (!evt.error) return;
	const isErr = evt.error instanceof Error;
	showErrorOverlay({
		framework: detectCurrentFramework() || undefined,
		kind: 'runtime',
		message: isErr ? evt.error.message : String(evt.error),
		stack: isErr ? evt.error.stack : undefined
	});
});

window.addEventListener('unhandledrejection', (evt) => {
	if (!evt.reason) return;
	const isErr = evt.reason instanceof Error;
	showErrorOverlay({
		framework: detectCurrentFramework() || undefined,
		kind: 'runtime',
		message: isErr ? evt.reason.message : String(evt.reason),
		stack: isErr ? evt.reason.stack : undefined
	});
});

const hmrUpdateTypes = new Set([
	'angular:component-update',
	'angular:component-remount',
	'angular:rebootstrap',
	'angular-update',
	'react-update',
	'html-update',
	'htmx-update',
	'vue-update',
	'svelte-update',
	'style-update',
	'module-update',
	'rebuild-start'
]);

type HMRMessage = {
	data: {
		affectedFrameworks?: string[];
		column?: number;
		error?: string;
		fastRefreshSupported?: boolean;
		file?: string;
		framework?: string;
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		html?: string;
		line?: number;
		lineText?: string;
		manifest?: Record<string, string>;
		moduleVersions?: Record<string, number>;
		pageModuleUrl?: string;
		primarySource?: string;
		scriptUrl?: string;
		serverDuration?: number;
		serverVersions?: Record<string, number>;
	};
	timestamp?: number;
	type: string;
};

const handleStylesheetUpdate = (message: HMRMessage) => {
	const clientStart = performance.now();
	void reloadCSSStylesheets(message.data.manifest ?? {}).then((applied) =>
		sendAbsoluteHmrTiming({
			clientStart,
			kind: 'css',
			outcome: applied ? 'applied' : 'failed',
			serverMs: message.data.serverDuration,
			updateId: message.timestamp
		})
	);
};

const handleHMRMessage = (message: HMRMessage) => {
	if (hmrUpdateTypes.has(message.type)) {
		hmrState.isHMRUpdating = true;
		setTimeout(() => {
			hmrState.isHMRUpdating = false;
		}, HMR_UPDATE_TIMEOUT_MS);
	}

	switch (message.type) {
		case 'manifest':
			handleManifest(message);
			break;
		case 'rebuild-start':
			break;
		case 'rebuild-complete':
			handleRebuildComplete(message);
			break;
		case 'framework-update':
			break;
		case 'module-update':
			hideErrorOverlay();
			handleModuleUpdate(message);
			break;
		case 'react-update':
			handleReactUpdate(message);
			break;
		case 'script-update':
			hideErrorOverlay();
			handleScriptUpdate(message);
			break;
		case 'html-update':
			hideErrorOverlay();
			handleHTMLUpdate(message);
			break;
		case 'htmx-update':
			hideErrorOverlay();
			handleHTMXUpdate(message);
			break;
		case 'svelte-update':
			hideErrorOverlay();
			handleSvelteUpdate(message);
			break;
		case 'vue-update':
			hideErrorOverlay();
			handleVueUpdate(message);
			break;
		case 'angular:component-update': {
			// Surgical-HMR fast path. Server resolved the changed
			// file → owning component classes and emitted one
			// message per affected component. Our injected
			// `__ng_hmr_load` blocks (see hmrInjectionPlugin.ts)
			// listen here and re-fetch the applyMetadata module.
			hideErrorOverlay();
			const { data } = message;
			if (isRecord(data)) {
				const id = Reflect.get(data, 'id');
				if (typeof id !== 'string') break;
				dispatchAngularComponentUpdate({
					id,
					timestamp:
						typeof message.timestamp === 'number'
							? message.timestamp
							: Date.now()
				});
			}
			break;
		}
		case 'angular:component-remount': {
			// Tier 1a per-component remount. Structural change
			// detected in fastHmr — the existing instance lacks new
			// fields / DI / providers, so we destroy + recreate just
			// this component (vs. full app rebootstrap). The injected
			// `__ng_hmr_remount` listener handles the splice via the
			// `__absAngularRemount` global wired in
			// `installAngularRemountGlobal`.
			hideErrorOverlay();
			const { data } = message;
			if (isRecord(data)) {
				const id = Reflect.get(data, 'id');
				if (typeof id !== 'string') break;
				dispatchAngularComponentRemount({
					id,
					timestamp:
						typeof message.timestamp === 'number'
							? message.timestamp
							: Date.now()
				});
			}
			break;
		}
		case 'angular:rebootstrap': {
			// Tier 1 fallback. The user's edit changed structure
			// the surgical path can't safely apply
			// (constructor/decorator/imports change, service edit,
			// etc.). The bundle has already been rebuilt server-side
			// and the manifest is updated. Call the chunk's baked-in
			// hook (set by the hydration template in compileAngular.ts)
			// to dynamic-import the fresh bundle URL — re-importing
			// re-runs the destroy + bootstrapApplication block.
			hideErrorOverlay();
			const { data } = message;
			if (isRecord(data) && isStringRecord(data.manifest)) {
				const { manifest } = data;
				window.__HMR_MANIFEST__ = manifest;
			}
			const rebootstrap = Reflect.get(
				window,
				'__ABS_ANGULAR_REBOOTSTRAP__'
			);
			if (typeof rebootstrap === 'function') {
				Promise.resolve(rebootstrap()).catch((err) => {
					console.error(
						'[absolutejs] angular:rebootstrap failed',
						err
					);
				});
			} else {
				// No hook = no Angular page loaded, or the hook
				// hasn't run yet. Falling back to a full reload is
				// safe and correct.
				window.location.reload();
			}
			break;
		}
		case 'rebuild-error':
			handleRebuildError(message);
			break;
		case 'full-reload':
			handleFullReload(message);
			break;
		case 'pong':
			break;
		case 'style-update':
			handleStylesheetUpdate(message);
			break;
		case 'angular-update':
			if (detectCurrentFramework() === 'angular') {
				handleStylesheetUpdate(message);
			}
			break;
		default:
			break;
	}
};

// Prevent multiple WebSocket connections
if (!(window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN)) {
	// Determine WebSocket URL
	const wsHost = location.hostname;
	const wsPort =
		location.port || (location.protocol === 'https:' ? '443' : '80');
	const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
	const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/hmr`;

	const wsc = new WebSocket(wsUrl);
	window.__HMR_WS__ = wsc;

	wsc.onopen = function () {
		hmrState.isConnected = true;
		hideConnectionLostBanner();
		sessionStorage.setItem('__HMR_CONNECTED__', 'true');

		const currentFramework = detectCurrentFramework();
		wsc.send(
			JSON.stringify({
				framework: currentFramework,
				target: absoluteHmrClientTarget(),
				type: 'ready'
			})
		);

		if (hmrState.reconnectTimeout) {
			clearTimeout(hmrState.reconnectTimeout);
			hmrState.reconnectTimeout = null;
		}

		hmrState.pingInterval = setInterval(() => {
			if (wsc.readyState === WebSocket.OPEN && hmrState.isConnected) {
				wsc.send(JSON.stringify({ type: 'ping' }));
			}
		}, PING_INTERVAL_MS);
	};

	wsc.onmessage = function (event: MessageEvent) {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch {
			return;
		}

		handleHMRMessage(message);
	};

	wsc.onclose = function (event: CloseEvent) {
		hmrState.isConnected = false;

		if (hmrState.pingInterval) {
			clearInterval(hmrState.pingInterval);
			hmrState.pingInterval = null;
		}

		if (event.code !== WEBSOCKET_NORMAL_CLOSURE) {
			showConnectionLostBanner();
			let attempts = 0;
			hmrState.reconnectTimeout = setTimeout(function pollServer() {
				attempts++;
				if (attempts > MAX_RECONNECT_ATTEMPTS) return;

				fetch('/hmr-status', { cache: 'no-store' })
					.then((res) => {
						if (res.ok) {
							window.location.reload();
						} else {
							hmrState.reconnectTimeout = setTimeout(
								pollServer,
								RECONNECT_POLL_INTERVAL_MS
							);
						}

						return undefined;
					})
					.catch(() => {
						hmrState.reconnectTimeout = setTimeout(
							pollServer,
							RECONNECT_POLL_INTERVAL_MS
						);
					});
			}, RECONNECT_INITIAL_DELAY_MS);
		}
	};

	wsc.onerror = function () {
		hmrState.isConnected = false;
	};

	window.addEventListener('beforeunload', () => {
		removeNativeSyncDevtools();
		if (hmrState.isHMRUpdating) {
			if (hmrState.pingInterval) clearInterval(hmrState.pingInterval);
			if (hmrState.reconnectTimeout)
				clearTimeout(hmrState.reconnectTimeout);

			return;
		}

		if (hmrState.pingInterval) clearInterval(hmrState.pingInterval);
		if (hmrState.reconnectTimeout) clearTimeout(hmrState.reconnectTimeout);
	});
}
