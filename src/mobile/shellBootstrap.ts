import { App } from '@capacitor/app';
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

const MANIFEST_PATH = './absolute-mobile-manifest.json';
const STATUS_ID = 'absolute-mobile-status';

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

const pushNavigationHistory = (path: string) => {
	if (!Reflect.get(globalThis, '__absoluteExpoBridge')) {
		history.pushState({ absoluteMobile: true }, '', path);

		return;
	}
	const url = new URL(location.href);
	url.search = '';
	url.hash = '';
	url.searchParams.set('absolutePath', path);
	history.pushState({ absoluteMobile: true }, '', url.href);
	const bridge: unknown = Reflect.get(globalThis, '__absoluteExpoBridge');
	if (
		typeof bridge === 'object' &&
		bridge !== null &&
		typeof Reflect.get(bridge, 'setPath') === 'function'
	) {
		Reflect.get(bridge, 'setPath').call(bridge, path);
	}
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
};

let navigationGeneration = 0;
let adaptiveShell: AbsoluteMobileAdaptiveShell | undefined;

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

const navigate = async (
	manifest: AbsoluteMobileClientManifest,
	path: string,
	pushHistory: boolean,
	fetchImpl?: AbsoluteMobileFetch
) => {
	await disposeAbsoluteMobilePage();
	renderStatus('Loading…');
	const envelope = await fetchAbsoluteMobilePage(manifest, path, {
		...(fetchImpl ? { fetch: fetchImpl } : {})
	});
	const activation = await activateAbsoluteMobilePage(envelope, {
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
	if (activation.kind === 'upgrade-required') {
		renderStatus('This app version must be updated to continue.', 'update');

		return;
	}
	adaptiveShell?.refreshDocument();
	if (pushHistory) pushNavigationHistory(path);
};

const installAnchorNavigation = (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (path: string) => void
) => {
	const handleClick = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a[href]');
		if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
		try {
			const path = resolveAbsoluteMobileNavigation(
				manifest,
				anchor.href,
				location.origin
			);
			if (!path) return;
			event.preventDefault();
			onNavigate(path);
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

const navigateWithFailureState = async (
	manifest: AbsoluteMobileClientManifest,
	path: string,
	pushHistory: boolean,
	reinstallBrowserNavigation: () => void,
	fetchImpl?: AbsoluteMobileFetch
) => {
	try {
		await navigate(manifest, path, pushHistory, fetchImpl);
	} catch (error) {
		console.error('[Absolute Mobile] Navigation failed:', error);
		renderStatus(
			document.documentElement.dataset.absoluteNetwork === 'offline'
				? 'You are offline. Reconnect to load this page.'
				: 'Unable to load this page. Check your connection and retry.',
			'error'
		);
	} finally {
		// Trusted HTML/HTMX documents use document.open(), which clears window
		// event listeners. Rebind after every activation and failure state.
		reinstallBrowserNavigation();
	}
};

export const startAbsoluteMobileShell = async (
	options: AbsoluteMobileShellOptions = {}
) => {
	notifyCapacitorSystemBarsDomReady();
	await adaptiveShell?.dispose();
	adaptiveShell = await installAbsoluteMobileAdaptiveShell();
	const manifest = await readManifest();
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
	let removeAnchorNavigation: () => void = () => undefined;
	const handlePopState = () => {
		const path = currentNavigationPath();
		notifyExpoNavigationPath(path);
		void navigateWithFailureState(
			manifest,
			path,
			false,
			reinstallBrowserNavigation,
			applicationFetch
		);
	};
	const reinstallBrowserNavigation = () => {
		removeAnchorNavigation();
		removeEventListener('popstate', handlePopState);
		removeAnchorNavigation = installAnchorNavigation(manifest, onNavigate);
		addEventListener('popstate', handlePopState);
	};
	const onNavigate = (path: string) => {
		void navigateWithFailureState(
			manifest,
			path,
			true,
			reinstallBrowserNavigation,
			applicationFetch
		);
	};
	await navigateWithFailureState(
		manifest,
		initialNavigationPath(manifest.entry),
		false,
		reinstallBrowserNavigation,
		applicationFetch
	);
	await installDeepLinks(manifest, onNavigate, auth?.redirectUri);
};
