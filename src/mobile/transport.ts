import {
	activateAbsoluteMobilePage,
	type AbsoluteMobilePageActivationOptions
} from './client';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION,
	MOBILE_PAGE_REQUEST_HEADERS
} from './pageProtocol';
import type {
	AbsoluteMobileCompatibilityPage,
	AbsoluteMobileCompatibilityRoute
} from './releaseArtifact';
import { resolveAbsoluteMobileRoute } from './routeMatcher';
import type { AbsoluteMobileAuthManifest } from './nativeAuth';
import type { SyncLocalStoreSchemaBundle } from '@absolutejs/sync/client';

export const ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT = 1 as const;

export type AbsoluteMobileFetch = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

export type AbsoluteMobileClientPage = AbsoluteMobileCompatibilityPage & {
	localBundlePath: string;
	localStylePath?: string;
};

export type AbsoluteMobileClientManifest = {
	auth?: AbsoluteMobileAuthManifest;
	appBuild: string;
	appId: string;
	appName: string;
	deepLinkHosts: string[];
	deepLinkScheme?: string;
	deviceCapabilities: string[];
	entry: string;
	format: typeof ABSOLUTE_MOBILE_CLIENT_MANIFEST_FORMAT;
	pages: AbsoluteMobileClientPage[];
	productionOrigin: string;
	routes: AbsoluteMobileCompatibilityRoute[];
	runtime: string;
	sync?: {
		socketTickets: true;
		background: { endpoint: string; intervalMinutes: number };
		storageSchema: SyncLocalStoreSchemaBundle;
	};
};

export type AbsoluteMobileTransportOptions = {
	fetch?: AbsoluteMobileFetch;
	headers?: HeadersInit;
};

const pageForPathname = (
	manifest: AbsoluteMobileClientManifest,
	pathname: string
) => {
	const route = resolveAbsoluteMobileRoute(manifest.routes, pathname);
	if (!route) {
		throw new TypeError(`No embedded mobile page owns ${pathname}.`);
	}
	const page = manifest.pages.find(
		(candidate) => candidate.pageId === route.pageId
	);
	if (!page) {
		throw new TypeError(
			`Mobile route ${route.pattern} references missing page ${route.pageId}.`
		);
	}

	return page;
};

const canonicalBackendUrl = (
	manifest: AbsoluteMobileClientManifest,
	path: string
) => {
	const origin = new URL(manifest.productionOrigin);
	const url = new URL(path, `${origin.origin}/`);
	if (url.origin !== origin.origin) {
		throw new TypeError('Mobile transport cannot leave productionOrigin.');
	}
	url.hash = '';

	return url;
};

export const createAbsoluteMobilePageRequest = (
	manifest: AbsoluteMobileClientManifest,
	path: string,
	options: AbsoluteMobileTransportOptions = {}
) => {
	const url = canonicalBackendUrl(manifest, path);
	const page = pageForPathname(manifest, url.pathname);
	const headers = new Headers(options.headers);
	headers.set('accept', ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE);
	headers.set(MOBILE_PAGE_REQUEST_HEADERS.appBuild, manifest.appBuild);
	headers.set(MOBILE_PAGE_REQUEST_HEADERS.pageBundle, page.bundleHash);
	headers.set(MOBILE_PAGE_REQUEST_HEADERS.pageContracts, page.contract);
	headers.set(MOBILE_PAGE_REQUEST_HEADERS.pageId, page.pageId);
	headers.set(
		MOBILE_PAGE_REQUEST_HEADERS.protocol,
		String(ABSOLUTE_MOBILE_PAGE_PROTOCOL_VERSION)
	);
	headers.set(MOBILE_PAGE_REQUEST_HEADERS.runtime, manifest.runtime);

	return new Request(url, { headers, method: 'GET' });
};

export const fetchAbsoluteMobilePage = async (
	manifest: AbsoluteMobileClientManifest,
	path: string,
	options: AbsoluteMobileTransportOptions = {}
) => {
	const request = createAbsoluteMobilePageRequest(manifest, path, options);
	const response = await (options.fetch ?? globalThis.fetch)(request);
	const value: unknown = await response.json();

	return value;
};

export const navigateAbsoluteMobilePage = async (
	manifest: AbsoluteMobileClientManifest,
	path: string,
	options: AbsoluteMobileTransportOptions &
		AbsoluteMobilePageActivationOptions
) => {
	const envelope = await fetchAbsoluteMobilePage(manifest, path, options);

	return activateAbsoluteMobilePage(envelope, options);
};

export const resolveAbsoluteMobileDeepLink = (
	manifest: AbsoluteMobileClientManifest,
	value: string
) => {
	const url = new URL(value);
	if (url.username || url.password) {
		throw new TypeError('Mobile deep links cannot contain credentials.');
	}
	const isHttpsHost =
		url.protocol === 'https:' &&
		manifest.deepLinkHosts.includes(url.hostname.toLowerCase());
	const isCustomScheme =
		manifest.deepLinkScheme !== undefined &&
		url.protocol === `${manifest.deepLinkScheme}:`;
	if (!isHttpsHost && !isCustomScheme) {
		throw new TypeError(
			'Mobile deep link is outside the configured app URLs.'
		);
	}

	return `${url.pathname || '/'}${url.search}${url.hash}`;
};

export const resolveAbsoluteMobileNavigation = (
	manifest: AbsoluteMobileClientManifest,
	value: string,
	localOrigin: string
) => {
	const url = new URL(value, `${localOrigin}/`);
	const local = new URL(localOrigin);
	const production = new URL(manifest.productionOrigin);
	const matches = (candidate: URL, allowed: URL) =>
		candidate.protocol === allowed.protocol &&
		candidate.host === allowed.host;
	if (!matches(url, local) && !matches(url, production)) {
		return undefined;
	}

	return `${url.pathname}${url.search}${url.hash}`;
};
