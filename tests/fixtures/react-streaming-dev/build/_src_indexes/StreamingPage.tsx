window.__HMR_FRAMEWORK__ = "react";
window.__REACT_COMPONENT_KEY__ = "StreamingPageIndex";
import '/home/alexkahn/abs/absolutejs/src/dev/client/reactRefreshSetup.ts';
import '/home/alexkahn/abs/absolutejs/src/dev/client/hmrClient.ts';
import { showErrorOverlay, hideErrorOverlay } from '/home/alexkahn/abs/absolutejs/src/dev/client/errorOverlay.ts';

import { hydrateRoot, createRoot } from 'react-dom/client';
import { createElement, Component } from 'react';
import { StreamingPage } from '/@src/tests/fixtures/react-streaming-dev/react/pages/StreamingPage';


// Dev-only Error Boundary to catch React render errors
class ErrorBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { hasError: false };
		window.__ERROR_BOUNDARY__ = this;
	}
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	componentDidCatch(error) {
		showErrorOverlay({
			framework: 'react',
			kind: 'runtime',
			message: error && error.stack ? error.stack : String(error)
		});
	}
	componentDidUpdate(prevProps, prevState) {
		if (prevState.hasError && !this.state.hasError) {
			hideErrorOverlay();
		}
	}
	reset() {
		this.setState({ hasError: false });
	}
	render() {
		if (this.state.hasError) return null;

		return this.props.children;
	}
}

// Hydration with error handling and fallback
const isDev = true;
const componentPath = '../../pages/StreamingPage';

function isHydrationError(error) {
	if (!error) return false;
	const errorMessage = error instanceof Error ? error.message : String(error);
	const errorString = String(error);
	const fullMessage = errorMessage + ' ' + errorString;
	const hydrationKeywords = ['hydration', 'Hydration', 'mismatch', 'Mismatch', 'did not match', 'server rendered HTML', 'server HTML', 'client HTML', 'Hydration failed'];
	const isHydration = hydrationKeywords.some(keyword => fullMessage.includes(keyword));
	
	// Ignore whitespace-only mismatches in <head> - these are harmless formatting differences
	// The error often shows: + <link...> vs - {"\n            "} which is just formatting
	if (isHydration) {
		// Check if this is a head/link/stylesheet related mismatch
		const isHeadRelated = fullMessage.includes('<head') || fullMessage.includes('</head>') || fullMessage.includes('head>') || fullMessage.includes('<link') || fullMessage.includes('link>') || fullMessage.includes('stylesheet') || fullMessage.includes('fonts.googleapis') || fullMessage.includes('rel="stylesheet"');
		
		// Check if the mismatch involves only whitespace/newlines
		// Pattern: looks for {"\n"} or {"\n            "} or similar whitespace-only content
		// Also check for patterns like: - {"\n            "} or + <link...>
		const hasWhitespacePattern = /\{\s*["']\\n[^"']*["']\s*\}/.test(fullMessage) || /\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage) || /-\s*\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage);
		const isWhitespaceOnly = /^[\s\n\r]*$/.test(errorString) || /^[\s\n\r]*$/.test(errorMessage);
		const hasNewlinePattern = fullMessage.includes('\\n') || fullMessage.includes('\\r') || fullMessage.includes('\n') || fullMessage.includes('\r');
		
		// If it's head-related and involves whitespace/newlines, ignore it
		if (isHeadRelated && (hasWhitespacePattern || isWhitespaceOnly || hasNewlinePattern)) {
			return false; // Don't treat whitespace-only head mismatches as errors
		}
	}
	return isHydration;
}

function logHydrationError(error, componentName) {
	if (!isDev) return;
	if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
		try {
			window.__HMR_WS__.send(JSON.stringify({
				type: 'hydration-error',
				data: {
					componentName: 'StreamingPage',
					componentPath: componentPath,
					error: error instanceof Error ? error.message : String(error),
					timestamp: Date.now()
				}
			}));
		} catch (err) {}
	}
}

// Track if we've already switched to client-only mode
let hasSwitchedToClientOnly = false;
let hydrationErrorDetected = false;

function handleHydrationFallback(error) {
	if (hasSwitchedToClientOnly) return; // Already handled
	hasSwitchedToClientOnly = true;
	hydrationErrorDetected = true;

	logHydrationError(error, 'StreamingPage');

	// Fallback: client-only render (no hydration)
	try {
		// Unmount existing root if it exists
		if (window.__REACT_ROOT__ && typeof window.__REACT_ROOT__.unmount === 'function') {
			try {
			window.__REACT_ROOT__.unmount();
			} catch (e) {
				// Ignore unmount errors
			}
		}

		// Render into the same root container when falling back to client-only
		const root = createRoot(container);
		root.render(createElement(ErrorBoundary, null, createElement(StreamingPage, mergedProps)));
		window.__REACT_ROOT__ = root;
		window.__HMR_CLIENT_ONLY_MODE__ = true;
	} catch (fallbackError) {
		window.location.reload();
	}
}

// HMR State Preservation: Check for preserved state and merge with initial props
// This allows state to be preserved across HMR updates without modifying component files
let preservedState = (typeof window !== 'undefined' && window.__HMR_PRESERVED_STATE__) ? window.__HMR_PRESERVED_STATE__ : {};

// Also check sessionStorage for state that survived a page reload (for React HMR)
if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
	const hmrStateJson = sessionStorage.getItem('__REACT_HMR_STATE__');
	if (hmrStateJson) {
		try {
			const hmrState = JSON.parse(hmrStateJson);
			preservedState = { ...preservedState, ...hmrState };
			sessionStorage.removeItem('__REACT_HMR_STATE__');
		} catch (e) {}
	}
}

const mergedProps = { ...(window.__INITIAL_PROPS__ || {}), ...preservedState };
// Clear preserved state after using it (so it doesn't persist across multiple updates)
if (typeof window !== 'undefined') {
	window.__HMR_PRESERVED_STATE__ = undefined;
}

// Attempt hydration with error handling
// Use document (not document.body) when the page renders <html><head><body>
// to avoid "In HTML, <html> cannot be a child of <body>" hydration error
const container = typeof document !== 'undefined' ? document : null;
if (!container) {
	throw new Error('React root container not found: document is null');
}

// Guard: only hydrate on first load. During HMR re-imports, skip hydration
// so React Fast Refresh can swap components in-place and preserve state.
if (!window.__REACT_ROOT__) {
	let root;
	// After HMR, SSR is skipped to avoid stale content flash — render client-only
	if (window.__SSR_DIRTY__) {
		root = createRoot(container);
		root.render(createElement(ErrorBoundary, null, createElement(StreamingPage, mergedProps)));
		window.__REACT_ROOT__ = root;
	} else {
	try {
		// Use onRecoverableError to catch hydration errors (React 19)
		root = hydrateRoot(
			container,
			createElement(ErrorBoundary, null, createElement(StreamingPage, mergedProps)),
			{
				onRecoverableError: (error) => {
					// Check if this is a hydration error (isHydrationError filters out whitespace-only head mismatches)
					if (isDev && isHydrationError(error)) {
						// Real hydration error - handle it
						handleHydrationFallback(error);
					} else {
						// Not a hydration error, or it's a whitespace-only mismatch that was filtered out
						// Check if it's a whitespace-only head mismatch using the same logic as isHydrationError
						const errorMessage = error instanceof Error ? error.message : String(error);
						const errorString = String(error);
						const fullMessage = errorMessage + ' ' + errorString;
						const hydrationKeywords = ['hydration', 'Hydration', 'mismatch', 'Mismatch', 'did not match', 'server rendered HTML', 'server HTML', 'client HTML', 'Hydration failed'];
						const isHydration = hydrationKeywords.some(keyword => fullMessage.includes(keyword));
						if (isHydration) {
							// Check if this is a head/link/stylesheet related mismatch
							const isHeadRelated = fullMessage.includes('<head') || fullMessage.includes('</head>') || fullMessage.includes('head>') || fullMessage.includes('<link') || fullMessage.includes('link>') || fullMessage.includes('stylesheet') || fullMessage.includes('fonts.googleapis') || fullMessage.includes('rel="stylesheet"');
							// Check if the mismatch involves only whitespace/newlines
							const hasWhitespacePattern = /\{\s*["']\\n[^"']*["']\s*\}/.test(fullMessage) || /\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage) || /-\s*\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage);
							const isWhitespaceOnly = /^[\s\n\r]*$/.test(errorString) || /^[\s\n\r]*$/.test(errorMessage);
							const hasNewlinePattern = fullMessage.includes('\\n') || fullMessage.includes('\\r') || fullMessage.includes('\n') || fullMessage.includes('\r');
							// If it's head-related and involves whitespace/newlines, silently ignore it
							if (isHeadRelated && (hasWhitespacePattern || isWhitespaceOnly || hasNewlinePattern)) {
								// Already logged by isHydrationError, just return silently
								return;
							}
						}
						// Log other recoverable errors
						console.error('React recoverable error:', error);
					}
				}
			}
		);
		window.__REACT_ROOT__ = root;
	} catch (error) {
		// Catch synchronous errors (shouldn't happen with hydrateRoot, but safety net)
		if (isDev && isHydrationError(error)) {
			handleHydrationFallback(error);
		} else {
			throw error;
		}
	}
	} // end else (normal hydration path)

	// Also listen for hydration errors via console.error (React logs them there)
	if (isDev) {
		const originalError = console.error;
		console.error = function(...args) {
			const errorMessage = args.map(arg => {
				if (arg instanceof Error) return arg.message;
				return String(arg);
			}).join(' ');
			
			// Check if this is a hydration error
			if (isHydrationError({ message: errorMessage }) && !hydrationErrorDetected) {
				hydrationErrorDetected = true;
				// Create a synthetic error for fallback
				const syntheticError = new Error(errorMessage);
				// Use setTimeout to ensure this happens after React's error handling
				setTimeout(() => {
					handleHydrationFallback(syntheticError);
				}, 0);
			}
			
			// Call original console.error
			originalError.apply(console, args);
		};
	}
}

// Pre-warm: import the page module from the module server
// immediately so the browser caches all /@src/ URLs.
import('/@src/tests/fixtures/react-streaming-dev/react/pages/StreamingPage.tsx').catch(() => {});