/* React HMR update handler
   Uses React Fast Refresh to hot-swap components while preserving state.
   Code splitting ensures React lives in a shared chunk that stays cached,
   so dynamic import of the rebuilt entry reuses the same React instance. */

import { hideErrorOverlay } from '../errorOverlay';
import { detectCurrentFramework } from '../frameworkDetect';

export const handleReactUpdate = (message: {
	data: {
		code?: string;
		hasCSSChanges?: boolean;
		hasComponentChanges?: boolean;
		manifest?: Record<string, string>;
		pageModuleUrl?: string;
		primarySource?: string;
		serverDuration?: number;
	};
}) => {
	const currentFramework = detectCurrentFramework();
	if (currentFramework !== 'react') return;

	const hasComponentChanges = message.data.hasComponentChanges !== false;
	const hasCSSChanges = message.data.hasCSSChanges === true;
	const cssPath =
		message.data.manifest && message.data.manifest.ReactExampleCSS;

	// CSS-only change: hot-swap the stylesheet link without reloading
	if (!hasComponentChanges && hasCSSChanges && cssPath) {
		reloadReactCSS(cssPath);

		return;
	}

	const refreshRuntime = window.$RefreshRuntime$;
	const serverDuration = message.data.serverDuration;

	// Inline code path: transpiled code sent via WebSocket.
	// Import from blob URL — no HTTP fetch, immune to bun --hot restarts.
	if (message.data.code && refreshRuntime) {
		applyInlineCode(message.data.code, refreshRuntime, serverDuration);

		return;
	}

	// ESM fast path: import the page module directly
	const pageModuleUrl = message.data.pageModuleUrl;

	if (pageModuleUrl && refreshRuntime) {
		applyRefreshImport(pageModuleUrl, refreshRuntime, serverDuration);

		return;
	}

	// Component change: use React Fast Refresh to preserve state
	const componentKey = window.__REACT_COMPONENT_KEY__;
	const newUrl = componentKey && message.data.manifest?.[componentKey];

	if (newUrl && refreshRuntime) {
		applyRefreshImport(newUrl, refreshRuntime, serverDuration);

		return;
	}

	// Fallback: full page reload
	window.location.reload();
};

// Import transpiled code from a blob URL — no HTTP fetch needed.
// Blob URLs resolve absolute imports (like /react/vendor/react.js)
// against the page's origin, so vendor imports work correctly.
const applyInlineCode = (
	code: string,
	refreshRuntime: { performReactRefresh: () => void },
	serverDuration?: number
) => {
	const clientStart = performance.now();

	// Convert absolute paths to full URLs so blob can resolve them
	const origin = window.location.origin;
	const fullCode = code.replace(
		/(from\s*["'])(\/[^"']+)(["'])/g,
		`$1${origin}$2$3`
	);

	const blob = new Blob([fullCode], { type: 'text/javascript' });
	const blobUrl = URL.createObjectURL(blob);

	import(blobUrl)
		.then(() => {
			URL.revokeObjectURL(blobUrl);
			refreshRuntime.performReactRefresh();

			if (window.__HMR_WS__) {
				const fetchMs = Math.round(performance.now() - clientStart);
				const total = (serverDuration ?? 0) + fetchMs;
				window.__HMR_WS__.send(
					JSON.stringify({
						duration: total,
						fetchMs,
						refreshMs: 0,
						serverMs: serverDuration ?? 0,
						type: 'hmr-timing'
					})
				);
			}

			if (window.__ERROR_BOUNDARY__) {
				window.__ERROR_BOUNDARY__.reset();
			} else {
				hideErrorOverlay();
			}

			return undefined;
		})
		.catch((err) => {
			URL.revokeObjectURL(blobUrl);
			console.warn(
				'[HMR] Inline code failed, falling back to fetch:',
				err
			);
			applyRefreshImport(
				'',
				refreshRuntime,
				serverDuration
			);
		});
};

const applyRefreshImport = (
	moduleUrl: string,
	refreshRuntime: { performReactRefresh: () => void },
	serverDuration?: number
) => {
	const clientStart = performance.now();
	import(`${moduleUrl}?t=${Date.now()}`)
		.then(() => {
			const fetchDone = performance.now();
			refreshRuntime.performReactRefresh();
			const refreshDone = performance.now();

			if (window.__HMR_WS__) {
				const fetchMs = Math.round(fetchDone - clientStart);
				const refreshMs = Math.round(refreshDone - fetchDone);
				const total = (serverDuration ?? 0) + fetchMs + refreshMs;
				window.__HMR_WS__.send(
					JSON.stringify({
						duration: total,
						fetchMs,
						refreshMs,
						serverMs: serverDuration ?? 0,
						type: 'hmr-timing'
					})
				);
			}

			if (window.__ERROR_BOUNDARY__) {
				window.__ERROR_BOUNDARY__.reset();
			} else {
				hideErrorOverlay();
			}

			return undefined;
		})
		.catch((err) => {
			console.warn(
				'[HMR] React Fast Refresh failed, falling back to reload:',
				err
			);
			window.location.reload();
		});
};

const reloadReactCSS = (cssPath: string) => {
	const existingCSSLinks = document.head.querySelectorAll<HTMLLinkElement>(
		'link[rel="stylesheet"]'
	);
	existingCSSLinks.forEach((link) => {
		const href = link.getAttribute('href');
		if (!href) {
			return;
		}
		const hrefBase = (href.split('?')[0] ?? '').split('/').pop() ?? '';
		const cssPathBase =
			(cssPath.split('?')[0] ?? '').split('/').pop() ?? '';
		if (
			hrefBase === cssPathBase ||
			href.includes('react-example') ||
			cssPathBase.includes(hrefBase)
		) {
			const newHref = `${
				cssPath + (cssPath.includes('?') ? '&' : '?')
			}t=${Date.now()}`;
			link.href = newHref;
		}
	});
};
