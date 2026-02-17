/* AbsoluteJS HMR Client - Entry point
   Initializes WebSocket connection, dispatches messages to framework handlers */

import './types'; // Window global type extensions

import { hmrState } from './types';
import { detectCurrentFramework } from './frameworkDetect';
import { handleReactUpdate } from './handlers/react';
import { handleHTMLUpdate, handleScriptUpdate } from './handlers/html';
import { handleHTMXUpdate } from './handlers/htmx';
import { handleSvelteUpdate } from './handlers/svelte';
import { handleVueUpdate } from './handlers/vue';
import {
	handleFullReload,
	handleManifest,
	handleModuleUpdate,
	handleRebuildComplete,
	handleRebuildError
} from './handlers/rebuild';

(function () {
	// Initialize HMR globals
	if (typeof window !== 'undefined') {
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

	// Prevent multiple WebSocket connections
	if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
		return;
	}

	// Determine WebSocket URL
	const wsHost = location.hostname;
	const wsPort =
		location.port || (location.protocol === 'https:' ? '443' : '80');
	const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
	const wsUrl = wsProtocol + '://' + wsHost + ':' + wsPort + '/hmr';

	const ws = new WebSocket(wsUrl);
	window.__HMR_WS__ = ws;

	ws.onopen = function () {
		hmrState.isConnected = true;
		sessionStorage.setItem('__HMR_CONNECTED__', 'true');

		const currentFramework = detectCurrentFramework();
		ws.send(
			JSON.stringify({
				framework: currentFramework,
				type: 'ready'
			})
		);

		if (hmrState.reconnectTimeout) {
			clearTimeout(hmrState.reconnectTimeout);
			hmrState.reconnectTimeout = null;
		}

		hmrState.pingInterval = setInterval(function () {
			if (ws.readyState === WebSocket.OPEN && hmrState.isConnected) {
				ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, 30000);
	};

	ws.onmessage = function (event: MessageEvent) {
		try {
			const message = JSON.parse(event.data as string);

			if (
				message.type === 'react-update' ||
				message.type === 'html-update' ||
				message.type === 'htmx-update' ||
				message.type === 'vue-update' ||
				message.type === 'svelte-update' ||
				message.type === 'module-update' ||
				message.type === 'rebuild-start'
			) {
				hmrState.isHMRUpdating = true;
				setTimeout(function () {
					hmrState.isHMRUpdating = false;
				}, 2000);
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
					handleModuleUpdate(message);
					break;

				case 'react-update':
					handleReactUpdate(message);
					break;

				case 'script-update':
					handleScriptUpdate(message);
					break;

				case 'html-update':
					handleHTMLUpdate(message);
					break;

				case 'htmx-update':
					handleHTMXUpdate(message);
					break;

				case 'svelte-update':
					handleSvelteUpdate(message);
					break;

				case 'vue-update':
					handleVueUpdate(message);
					break;

				case 'rebuild-error':
					handleRebuildError(message);
					break;

				case 'full-reload':
					handleFullReload();
					break;

				case 'pong':
					break;

				case 'connected':
					break;

				default:
					break;
			}
		} catch {
			/* ignore parse errors */
		}
	};

	ws.onclose = function (event: CloseEvent) {
		hmrState.isConnected = false;

		if (hmrState.pingInterval) {
			clearInterval(hmrState.pingInterval);
			hmrState.pingInterval = null;
		}

		if (event.code !== 1000) {
			let attempts = 0;
			hmrState.reconnectTimeout = setTimeout(function pollServer() {
				attempts++;
				if (attempts > 60) return;

				fetch('/hmr-status', { cache: 'no-store' })
					.then(function (res) {
						if (res.ok) {
							window.location.reload();
						} else {
							hmrState.reconnectTimeout = setTimeout(
								pollServer,
								300
							);
						}
					})
					.catch(function () {
						hmrState.reconnectTimeout = setTimeout(pollServer, 300);
					});
			}, 500);
		}
	};

	ws.onerror = function () {
		hmrState.isConnected = false;
	};

	window.__HMR_WS__ = ws;

	window.addEventListener('beforeunload', function () {
		if (hmrState.isHMRUpdating) {
			if (hmrState.pingInterval) clearInterval(hmrState.pingInterval);
			if (hmrState.reconnectTimeout)
				clearTimeout(hmrState.reconnectTimeout);
			return;
		}

		if (hmrState.pingInterval) clearInterval(hmrState.pingInterval);
		if (hmrState.reconnectTimeout) clearTimeout(hmrState.reconnectTimeout);
	});
})();
