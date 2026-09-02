import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { PluginListenerHandle } from '@capacitor/core';
import {
	fetchAbsoluteMobilePage,
	resolveAbsoluteMobileDeepLink,
	resolveAbsoluteMobileNavigation,
	type AbsoluteMobileFetch,
	type AbsoluteMobileClientManifest
} from './transport';
import {
	activateAbsoluteMobilePage,
	disposeAbsoluteMobilePage
} from './client';
import { installAbsoluteMobileStaticDocument } from './staticDocument';
import { installAbsoluteMobileShellHttp } from './shellHttp';
import {
	installAbsoluteMobileAdaptiveShell,
	type AbsoluteMobileAdaptiveShell
} from './adaptiveShell';
import {
	installAbsoluteMobileUiPrimitives,
	readAbsoluteMobileLinkIntent,
	type AbsoluteMobileNavigationDirection,
	type AbsoluteMobileUiPrimitives
} from './uiPrimitives';
import {
	createAbsoluteMobileNavigationCoordinator,
	type AbsoluteMobileNavigationRequest
} from './navigationLifecycle';
import {
	captureAbsoluteMobileDocumentState,
	createAbsoluteMobileHistoryEntry,
	readAbsoluteMobileHistoryEntry,
	resetAbsoluteMobileDocumentState,
	restoreAbsoluteMobileDocumentState,
	type AbsoluteMobileDocumentSnapshot,
	type AbsoluteMobileHistoryEntry
} from './navigationState';

const MANIFEST_PATH = './absolute-mobile-manifest.json';
const STATUS_ID = 'absolute-mobile-status';
const NAVIGATION_ERROR_ID = 'absolute-mobile-navigation-error';

type AbsoluteViewTransition = {
	finished: Promise<void>;
	updateCallbackDone: Promise<void>;
};

type AbsoluteViewTransitionDocument = Document & {
	startViewTransition?: (
		update: () => Promise<void> | void
	) => AbsoluteViewTransition;
};

const initialNavigationPath = (entry: string) => {
	const expoPath = new URLSearchParams(location.search).get('absolutePath');
	if (expoPath?.startsWith('/') && !expoPath.startsWith('//'))
		return expoPath;
	const current = `${location.pathname}${location.search}${location.hash}`;

	return current === '/' || current === '/index.html' ? entry : current;
};

const currentNavigationPath = () => {
	const expoPath = new URLSearchParams(location.search).get('absolutePath');

	return expoPath?.startsWith('/') && !expoPath.startsWith('//')
		? expoPath
		: `${location.pathname}${location.search}${location.hash}`;
};

const historyUrl = (path: string) => {
	if (!Reflect.get(globalThis, '__absoluteExpoBridge')) {
		return path;
	}
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('absolutePath', path);

	return url.href;
};

const writeNavigationHistory = (
	entry: AbsoluteMobileHistoryEntry,
	mode: 'push' | 'replace'
) => {
	history[mode === 'push' ? 'pushState' : 'replaceState'](
		entry,
		'',
		historyUrl(entry.path)
	);
	notifyExpoNavigationPath(entry.path);
};

const notifyExpoNavigationPath = (path: string) => {
	const bridge: unknown = Reflect.get(globalThis, '__absoluteExpoBridge');
	if (
		typeof bridge === 'object' &&
		bridge !== null &&
		typeof Reflect.get(bridge, 'setPath') === 'function'
	) {
		Reflect.get(bridge, 'setPath').call(bridge, path);
	}
};

export type AbsoluteMobileShellAuthRuntime = {
	clientId: string;
	fetch: AbsoluteMobileFetch;
	onPrincipalChange: (
		listener: (principal: AbsoluteMobileShellPrincipal | null) => void
	) => () => void;
	principal: AbsoluteMobileShellPrincipal | null;
	redirectUri: string;
	issuer: string;
	socketTicket: (audience?: string) => Promise<string>;
};

export type AbsoluteMobileShellPrincipal = {
	namespace: string;
};

export type AbsoluteMobileShellOptions = {
	createFetch?: (
		manifest: AbsoluteMobileClientManifest
	) => AbsoluteMobileFetch;
	createAuth?: (
		config: NonNullable<AbsoluteMobileClientManifest['auth']>,
		options?: { beforeSignOut?: () => Promise<void> | void }
	) => Promise<AbsoluteMobileShellAuthRuntime>;
	beforeSignOut?: () => Promise<void> | void;
	connectPush?: (auth: AbsoluteMobileShellAuthRuntime) => void;
	installSync?: (
		auth: AbsoluteMobileShellAuthRuntime,
		config: NonNullable<AbsoluteMobileClientManifest['sync']>
	) => void | (() => void);
	installUpdates?: (manifest: AbsoluteMobileClientManifest) => Promise<void>;
};

let navigationGeneration = 0;
let adaptiveShell: AbsoluteMobileAdaptiveShell | undefined;
let uiPrimitives: AbsoluteMobileUiPrimitives | undefined;

const notifyCapacitorSystemBarsDomReady = () => {
	const provider = Reflect.get(
		globalThis,
		'CapacitorSystemBarsAndroidInterface'
	);
	if (typeof provider !== 'object' || provider === null) return;
	const onDOMReady = Reflect.get(provider, 'onDOMReady');
	if (typeof onDOMReady !== 'function') return;
	try {
		onDOMReady.call(provider);
	} catch {
		// A stale or incompatible Android bridge must not block shell startup.
	}
};

const readManifest = async () => {
	const response = await fetch(MANIFEST_PATH, { cache: 'no-store' });
	if (!response.ok) {
		throw new TypeError(
			`Mobile manifest failed with HTTP ${response.status}.`
		);
	}

	const manifest: AbsoluteMobileClientManifest = await response.json();

	return manifest;
};

const renderStatus = (
	message: string,
	kind: 'error' | 'loading' | 'update' = 'loading'
) => {
	document.title = 'AbsoluteJS';
	document.head.innerHTML =
		'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
	document.body.innerHTML = `<main id="${STATUS_ID}" data-absolute-mobile-status="${kind}" role="status" aria-atomic="true" aria-live="polite"></main>`;
	const status = document.getElementById(STATUS_ID);
	if (status) status.textContent = message;
	adaptiveShell?.refreshDocument();
};

const clearNavigationFailure = () => {
	document.getElementById(NAVIGATION_ERROR_ID)?.remove();
};

const renderNavigationFailure = (message: string, retry: () => void) => {
	clearNavigationFailure();
	const error = document.createElement('aside');
	error.id = NAVIGATION_ERROR_ID;
	error.dataset.absoluteMobileNavigationError = '';
	error.setAttribute('role', 'alert');
	error.style.cssText =
		'position:fixed;z-index:2147483646;inset:auto max(1rem,var(--absolute-safe-area-inset-right,0px)) max(1rem,var(--absolute-safe-area-inset-bottom,0px)) max(1rem,var(--absolute-safe-area-inset-left,0px));display:flex;align-items:center;justify-content:space-between;gap:1rem;box-sizing:border-box;padding:.75rem 1rem;border:1px solid color-mix(in srgb,CanvasText 24%,transparent);border-radius:.75rem;background:Canvas;color:CanvasText;box-shadow:0 .5rem 2rem color-mix(in srgb,CanvasText 20%,transparent)';
	const text = document.createElement('span');
	text.textContent = message;
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = 'Retry';
	button.addEventListener('click', retry, { once: true });
	error.append(text, button);
	document.body.append(error);
};

const markNavigationPending = (pending: boolean) => {
	if (pending) {
		document.body.dataset.absoluteMobileNavigationPending = '';
		document.body.setAttribute('aria-busy', 'true');
	} else {
		delete document.body.dataset.absoluteMobileNavigationPending;
		document.body.removeAttribute('aria-busy');
	}
};

const renderPageTarget = () => {
	document.title = 'AbsoluteJS';
	document.head.innerHTML =
		'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
	document.body.innerHTML = '<div id="root"></div>';
	adaptiveShell?.refreshDocument();
};

const localBundleUrl = (
	manifest: AbsoluteMobileClientManifest,
	pageId: string,
	contract: string
) => {
	const page = manifest.pages.find(
		(candidate) =>
			candidate.pageId === pageId && candidate.contract === contract
	);
	if (!page) {
		throw new TypeError(
			`The embedded app does not contain ${pageId} contract ${contract}.`
		);
	}
	const url = new URL(page.localBundlePath, document.baseURI);
	url.searchParams.set(
		'absoluteNavigation',
		String((navigationGeneration += 1))
	);

	return url.href;
};

const installLocalPageStyle = (
	manifest: AbsoluteMobileClientManifest,
	pageId: string,
	contract: string
) => {
	const page = manifest.pages.find(
		(candidate) =>
			candidate.pageId === pageId && candidate.contract === contract
	);
	if (!page?.localStylePath) return;
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = new URL(page.localStylePath, document.baseURI).href;
	link.dataset.absoluteMobilePageStyle = page.bundleHash;
	document.head.appendChild(link);
};

const waitForDocumentPaint = () =>
	new Promise<void>((resolve) => {
		if (typeof requestAnimationFrame !== 'function') {
			setTimeout(resolve, 0);

			return;
		}
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});

const commitNavigation = async (
	manifest: AbsoluteMobileClientManifest,
	envelope: unknown,
	hadActivePage: boolean
) => {
	if (!hadActivePage) renderStatus('Loading…');
	let activation:
		| Awaited<ReturnType<typeof activateAbsoluteMobilePage>>
		| undefined;
	const commit = async () => {
		await disposeAbsoluteMobilePage();
		activation = await activateAbsoluteMobilePage(envelope, {
			loadPage: ({ contract, pageId }) => {
				const page = manifest.pages.find(
					(candidate) =>
						candidate.pageId === pageId &&
						candidate.contract === contract
				);
				if (!page) {
					throw new TypeError(
						`The embedded app does not contain ${pageId} contract ${contract}.`
					);
				}
				if (page.framework === 'html' || page.framework === 'htmx') {
					return installAbsoluteMobileStaticDocument(
						manifest,
						page,
						localBundleUrl(manifest, pageId, contract)
					);
				}
				renderPageTarget();
				installLocalPageStyle(manifest, pageId, contract);

				return import(localBundleUrl(manifest, pageId, contract));
			}
		});
	};
	const transitionDocument: AbsoluteViewTransitionDocument = document;
	if (
		hadActivePage &&
		document.documentElement.dataset.absoluteReducedMotion !== 'reduce' &&
		transitionDocument.startViewTransition
	) {
		const transition = transitionDocument.startViewTransition(commit);
		await transition.updateCallbackDone;
		await transition.finished.catch(() => undefined);
	} else await commit();
	if (!activation)
		throw new TypeError('The mobile page did not produce an activation.');
	if (activation.kind === 'upgrade-required') {
		renderStatus('This app version must be updated to continue.', 'update');

		return false;
	}
	// Framework bootstraps may resolve their module-level ready promise before
	// React/Vue/Svelte has committed DOM. Publish shell readiness after paint so
	// focus, history, and a following disposal observe the committed document.
	await waitForDocumentPaint();
	document.body.dataset.absoluteMobilePageActive = '';
	adaptiveShell?.refreshDocument();

	return true;
};

const openExternalLink = (anchor: HTMLAnchorElement, event: MouseEvent) => {
	if (Reflect.get(globalThis, '__absoluteExpoBridge')) return;
	try {
		const url = new URL(anchor.href);
		if (
			url.username ||
			url.password ||
			(url.protocol !== 'http:' && url.protocol !== 'https:')
		)
			return;
		event.preventDefault();
		void Browser.open({ url: url.href }).catch(() =>
			location.assign(url.href)
		);
	} catch {
		// Invalid author URLs retain their ordinary browser behavior.
	}
};

const installAnchorNavigation = (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (
		path: string,
		direction?: AbsoluteMobileNavigationDirection,
		replace?: boolean
	) => void,
	onBack: () => boolean
) => {
	const handleClick = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a[href]');
		if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
		const intent = readAbsoluteMobileLinkIntent(anchor);
		if (intent.kind === 'back') {
			event.preventDefault();
			if (!uiPrimitives?.requestBack() && !onBack()) history.back();

			return;
		}
		if (intent.kind === 'external') {
			openExternalLink(anchor, event);

			return;
		}
		try {
			const path = resolveAbsoluteMobileNavigation(
				manifest,
				anchor.href,
				location.origin
			);
			if (!path) return;
			event.preventDefault();
			onNavigate(
				path,
				intent.kind === 'navigate' && intent.replace
					? 'replace'
					: 'forward',
				intent.kind === 'navigate' && intent.replace
			);
		} catch {
			// Invalid author-provided links keep their normal browser behavior.
		}
	};
	addEventListener('click', handleClick);

	return () => removeEventListener('click', handleClick);
};

const navigateDeepLink = (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (path: string) => void,
	url: string | undefined,
	authRedirectUri?: string
) => {
	if (!url) return;
	if (authRedirectUri) {
		const actual = new URL(url);
		const redirect = new URL(authRedirectUri);
		if (
			actual.protocol === redirect.protocol &&
			actual.host === redirect.host &&
			actual.pathname === redirect.pathname
		)
			return;
	}
	onNavigate(resolveAbsoluteMobileDeepLink(manifest, url));
};

const deepLinkListener =
	(
		manifest: AbsoluteMobileClientManifest,
		onNavigate: (path: string) => void,
		authRedirectUri?: string
	) =>
	({ url }: { url: string }) =>
		navigateDeepLink(manifest, onNavigate, url, authRedirectUri);

const installDeepLinks = async (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (path: string) => void,
	authRedirectUri?: string
) => {
	let listener: PluginListenerHandle | undefined;
	try {
		listener = await App.addListener(
			'appUrlOpen',
			deepLinkListener(manifest, onNavigate, authRedirectUri)
		);
		const launch = await App.getLaunchUrl();
		navigateDeepLink(manifest, onNavigate, launch?.url, authRedirectUri);
	} catch {
		// The web preview has no native App plugin. Navigation still works.
	}

	return listener;
};

export const startAbsoluteMobileShell = async (
	options: AbsoluteMobileShellOptions = {}
) => {
	notifyCapacitorSystemBarsDomReady();
	await adaptiveShell?.dispose();
	uiPrimitives?.dispose();
	adaptiveShell = await installAbsoluteMobileAdaptiveShell();
	uiPrimitives = installAbsoluteMobileUiPrimitives();
	const manifest = await readManifest();
	let activePath = initialNavigationPath(manifest.entry);
	let activeEntry =
		readAbsoluteMobileHistoryEntry(history.state) ??
		createAbsoluteMobileHistoryEntry(activePath, 0);
	if (activeEntry.path !== activePath) {
		activeEntry = createAbsoluteMobileHistoryEntry(activePath, 0);
	}
	writeNavigationHistory(activeEntry, 'replace');
	const auth =
		manifest.auth && options.createAuth
			? await options.createAuth(manifest.auth, {
					beforeSignOut: options.beforeSignOut
				})
			: undefined;
	const applicationFetch =
		auth?.fetch ?? options.createFetch?.(manifest) ?? globalThis.fetch;
	installAbsoluteMobileShellHttp(manifest.productionOrigin, applicationFetch);
	if (auth) options.connectPush?.(auth);
	if (auth && manifest.sync?.socketTickets)
		options.installSync?.(auth, manifest.sync);
	const snapshots = new Map<string, AbsoluteMobileDocumentSnapshot>();
	const targetEntries = new WeakMap<
		AbsoluteMobileNavigationRequest,
		AbsoluteMobileHistoryEntry
	>();
	let suppressNextPop = false;
	let hasActivePage = false;
	let removeAnchorNavigation: () => void = () => undefined;
	const coordinator = createAbsoluteMobileNavigationCoordinator<unknown>({
		commit: async (envelope, request) => {
			if (hasActivePage) {
				snapshots.set(
					activeEntry.entryId,
					captureAbsoluteMobileDocumentState()
				);
			}
			document.documentElement.dataset.absoluteNavigationDirection =
				request.direction;
			try {
				const previouslyActive = hasActivePage;
				hasActivePage = false;
				hasActivePage = await commitNavigation(
					manifest,
					envelope,
					previouslyActive
				);
			} finally {
				// Static HTML/HTMX activation replaces the document body. Rebind the
				// shell-owned listeners after every attempted commit.
				reinstallBrowserNavigation();
			}
		},
		load: (request, signal) =>
			fetchAbsoluteMobilePage(manifest, request.path, {
				fetch: applicationFetch,
				signal
			}),
		onFailure: (error, phase, request) => {
			console.error('[Absolute Mobile] Navigation failed:', error);
			markNavigationPending(false);
			const targetEntry = targetEntries.get(request);
			if (targetEntry && targetEntry.index !== activeEntry.index) {
				suppressNextPop = true;
				history.go(activeEntry.index - targetEntry.index);
			}
			const message =
				document.documentElement.dataset.absoluteNetwork === 'offline'
					? 'You are offline. Reconnect to load this page.'
					: 'Unable to load this page. Check your connection and retry.';
			if (phase === 'load' && hasActivePage) {
				renderNavigationFailure(message, () => {
					if (targetEntry) {
						history.go(targetEntry.index - activeEntry.index);
					} else void coordinator.navigate(request);
				});
			} else renderStatus(message, 'error');
		},
		onStart: () => {
			clearNavigationFailure();
			markNavigationPending(true);
		},
		onSuccess: (request) => {
			let nextEntry = targetEntries.get(request);
			if (request.historyMode === 'push') {
				nextEntry = createAbsoluteMobileHistoryEntry(
					request.path,
					activeEntry.index + 1
				);
				writeNavigationHistory(nextEntry, 'push');
			} else if (request.historyMode === 'replace') {
				nextEntry = createAbsoluteMobileHistoryEntry(
					request.path,
					activeEntry.index
				);
				writeNavigationHistory(nextEntry, 'replace');
			}
			nextEntry ??= activeEntry;
			activeEntry = nextEntry;
			activePath = request.path;
			markNavigationPending(false);
			clearNavigationFailure();
			const snapshot = snapshots.get(activeEntry.entryId);
			if (snapshot) restoreAbsoluteMobileDocumentState(snapshot);
			else if (request.historyMode !== 'none')
				resetAbsoluteMobileDocumentState();
			uiPrimitives?.navigate({
				direction: request.direction,
				from: request.from,
				to: request.path
			});
		}
	});
	const cancelPendingNavigation = () => {
		if (!coordinator.cancelPending()) return false;
		markNavigationPending(false);
		clearNavigationFailure();

		return true;
	};
	const handlePopState = (event: PopStateEvent) => {
		const path = currentNavigationPath();
		if (suppressNextPop) {
			suppressNextPop = false;
			notifyExpoNavigationPath(activePath);

			return;
		}
		const targetEntry =
			readAbsoluteMobileHistoryEntry(event.state) ??
			createAbsoluteMobileHistoryEntry(path, activeEntry.index - 1);
		notifyExpoNavigationPath(path);
		const request: AbsoluteMobileNavigationRequest = {
			direction:
				targetEntry.index > activeEntry.index ? 'forward' : 'back',
			from: activePath,
			historyMode: 'none',
			path
		};
		targetEntries.set(request, targetEntry);
		void coordinator.navigate(request);
	};
	const reinstallBrowserNavigation = () => {
		removeAnchorNavigation();
		removeEventListener('popstate', handlePopState);
		uiPrimitives?.dispose();
		uiPrimitives = installAbsoluteMobileUiPrimitives();
		uiPrimitives.refreshDocument(activePath);
		removeAnchorNavigation = installAnchorNavigation(
			manifest,
			onNavigate,
			cancelPendingNavigation
		);
		addEventListener('popstate', handlePopState);
	};
	const onNavigate = (
		path: string,
		direction: AbsoluteMobileNavigationDirection = 'forward',
		replace = false
	) => {
		if (path === activePath && !replace && hasActivePage) return;
		void coordinator.navigate({
			direction,
			from: activePath,
			historyMode: replace ? 'replace' : 'push',
			path
		});
	};
	// Capture taps before the first page activation completes. A user may interact
	// as soon as framework content paints, which can precede its ready promise.
	reinstallBrowserNavigation();
	await coordinator.navigate({
		direction: 'replace',
		from: activePath,
		historyMode: 'none',
		path: activePath
	});
	await options.installUpdates?.(manifest);
	await installDeepLinks(manifest, onNavigate, auth?.redirectUri);
	try {
		await App.addListener('backButton', ({ canGoBack }) => {
			if (uiPrimitives?.requestBack()) return;
			if (cancelPendingNavigation()) return;
			if (canGoBack) history.back();
			else void App.exitApp();
		});
	} catch {
		// Browser previews do not expose native Android back handling.
	}
};
