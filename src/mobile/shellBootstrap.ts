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

const MANIFEST_PATH = './absolute-mobile-manifest.json';
const STATUS_ID = 'absolute-mobile-status';

export type AbsoluteMobileShellAuthRuntime = {
	fetch: AbsoluteMobileFetch;
	redirectUri: string;
	socketTicket: (audience?: string) => Promise<string>;
};

export type AbsoluteMobileShellOptions = {
	createAuth?: (
		config: NonNullable<AbsoluteMobileClientManifest['auth']>
	) => Promise<AbsoluteMobileShellAuthRuntime>;
	installSync?: (auth: AbsoluteMobileShellAuthRuntime) => void;
};

let navigationGeneration = 0;

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

const renderStatus = (message: string) => {
	document.title = 'AbsoluteJS';
	document.head.innerHTML =
		'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
	document.body.innerHTML = `<main id="${STATUS_ID}" role="status"></main>`;
	const status = document.getElementById(STATUS_ID);
	if (status) status.textContent = message;
};

const renderPageTarget = () => {
	document.title = 'AbsoluteJS';
	document.head.innerHTML =
		'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
	document.body.innerHTML = '<div id="root"></div>';
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
		renderStatus('This app version must be updated to continue.');

		return;
	}
	if (pushHistory) history.pushState({ absoluteMobile: true }, '', path);
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
			'Unable to load this page. Check your connection and retry.'
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
	const manifest = await readManifest();
	const auth =
		manifest.auth && options.createAuth
			? await options.createAuth(manifest.auth)
			: undefined;
	if (auth && manifest.sync?.socketTickets) options.installSync?.(auth);
	let removeAnchorNavigation: () => void = () => undefined;
	const handlePopState = () => {
		void navigateWithFailureState(
			manifest,
			`${location.pathname}${location.search}${location.hash}`,
			false,
			reinstallBrowserNavigation,
			auth?.fetch
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
			auth?.fetch
		);
	};
	await navigateWithFailureState(
		manifest,
		manifest.entry,
		false,
		reinstallBrowserNavigation,
		auth?.fetch
	);
	await installDeepLinks(manifest, onNavigate, auth?.redirectUri);
};
