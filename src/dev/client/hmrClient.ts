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
import { hideErrorOverlay, showErrorOverlay } from './errorOverlay';
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

// Initialize HMR globals
if (typeof window !== 'undefined') {
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
	type: string;
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
			const data = message.data as
				| { id?: string; timestamp?: number }
				| undefined;
			if (data && typeof data.id === 'string') {
				dispatchAngularComponentUpdate({
					id: data.id,
					timestamp:
						typeof data.timestamp === 'number'
							? data.timestamp
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
			const data = message.data as
				| { id?: string; timestamp?: number }
				| undefined;
			if (data && typeof data.id === 'string') {
				dispatchAngularComponentRemount({
					id: data.id,
					timestamp:
						typeof data.timestamp === 'number'
							? data.timestamp
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
			const data = message.data as
				| { manifest?: Record<string, string>; reason?: string }
				| undefined;
			if (data?.manifest) {
				window.__HMR_MANIFEST__ = data.manifest;
			}
			const w = window as Window & {
				__ABS_ANGULAR_REBOOTSTRAP__?: () => Promise<void>;
			};
			if (typeof w.__ABS_ANGULAR_REBOOTSTRAP__ === 'function') {
				w.__ABS_ANGULAR_REBOOTSTRAP__().catch((err) => {
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
			handleFullReload();
			break;
		case 'pong':
			break;
		case 'style-update':
			reloadCSSStylesheets(message.data.manifest ?? {});
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
		sessionStorage.setItem('__HMR_CONNECTED__', 'true');

		const currentFramework = detectCurrentFramework();
		wsc.send(
			JSON.stringify({
				framework: currentFramework,
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
