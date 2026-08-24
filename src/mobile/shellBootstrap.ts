import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import {
	fetchAbsoluteMobilePage,
	resolveAbsoluteMobileDeepLink,
	type AbsoluteMobileClientManifest
} from './transport';
import {
	activateAbsoluteMobilePage,
	disposeAbsoluteMobilePage
} from './client';

const MANIFEST_PATH = './absolute-mobile-manifest.json';
const STATUS_ID = 'absolute-mobile-status';

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
	document.open();
	document.write(
		`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>AbsoluteJS</title></head><body><main id="${STATUS_ID}" role="status"></main></body></html>`
	);
	document.close();
	const status = document.getElementById(STATUS_ID);
	if (status) status.textContent = message;
};

const renderPageTarget = () => {
	document.open();
	document.write(
		'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>AbsoluteJS</title></head><body><div id="root"></div></body></html>'
	);
	document.close();
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
	pushHistory: boolean
) => {
	await disposeAbsoluteMobilePage();
	renderStatus('Loading…');
	const envelope = await fetchAbsoluteMobilePage(manifest, path);
	renderPageTarget();
	const activation = await activateAbsoluteMobilePage(envelope, {
		loadPage: ({ contract, pageId }) => {
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
	addEventListener('click', (event) => {
		if (!(event.target instanceof Element)) return;
		const anchor = event.target.closest('a[href]');
		if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
		try {
			const url = new URL(anchor.href);
			if (url.origin !== manifest.productionOrigin) return;
			event.preventDefault();
			onNavigate(`${url.pathname}${url.search}${url.hash}`);
		} catch {
			// Invalid author-provided links keep their normal browser behavior.
		}
	});
};

const navigateDeepLink = (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (path: string) => void,
	url: string | undefined
) => {
	if (!url) return;
	onNavigate(resolveAbsoluteMobileDeepLink(manifest, url));
};

const deepLinkListener =
	(
		manifest: AbsoluteMobileClientManifest,
		onNavigate: (path: string) => void
	) =>
	({ url }: { url: string }) =>
		navigateDeepLink(manifest, onNavigate, url);

const installDeepLinks = async (
	manifest: AbsoluteMobileClientManifest,
	onNavigate: (path: string) => void
) => {
	let listener: PluginListenerHandle | undefined;
	try {
		listener = await App.addListener(
			'appUrlOpen',
			deepLinkListener(manifest, onNavigate)
		);
		const launch = await App.getLaunchUrl();
		navigateDeepLink(manifest, onNavigate, launch?.url);
	} catch {
		// The web preview has no native App plugin. Navigation still works.
	}

	return listener;
};

const navigateWithFailureState = (
	manifest: AbsoluteMobileClientManifest,
	path: string
) => {
	void navigate(manifest, path, true).catch((error: unknown) => {
		console.error('[Absolute Mobile] Navigation failed:', error);
		renderStatus(
			'Unable to load this page. Check your connection and retry.'
		);
	});
};

export const startAbsoluteMobileShell = async () => {
	const manifest = await readManifest();
	const onNavigate = (path: string) =>
		navigateWithFailureState(manifest, path);
	installAnchorNavigation(manifest, onNavigate);
	addEventListener('popstate', () => {
		void navigate(
			manifest,
			`${location.pathname}${location.search}${location.hash}`,
			false
		);
	});
	await installDeepLinks(manifest, onNavigate);
	await navigate(manifest, manifest.entry, false);
};
