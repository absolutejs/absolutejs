/**
 * Cross-framework document navigation.
 *
 * Every framework router (React Router via `<UniversalRouter>`, the Svelte
 * router, vue-router, Angular's router) handles the URLs it has routes for
 * and lets every other link fall through to a real page load. This layer
 * catches those fall-through navigations and turns them into a soft swap:
 *
 *   fetch the target HTML → load its stylesheets → tear down the current
 *   page (`window.__ABSOLUTE_PAGE_DISPOSE__`) → swap <head>/<body> (in a
 *   View Transition where supported) → run the target's scripts → the
 *   target's hydration index hydrates the new body.
 *
 * So a React page links to a Svelte page (and back) without a reload, and
 * `createIslandStore` state lives on: the store snapshot sits on
 * `globalThis`, which a swap never resets.
 *
 *   import { enableNavigation } from '@absolutejs/absolute/client/navigation';
 *   enableNavigation();
 *
 * Opt-in per app (call it from every page that should take part; the
 * first call installs, the rest are no-ops) and opt-out per link with
 * `data-absolute-navigation="off"` (on the link or an ancestor). Any
 * error falls back to a full page load.
 *
 * CSP: a fetched page's inline scripts carry THAT response's nonce, which
 * the current document's policy rejects. Scripts and styles are recreated
 * with the current document's nonce, but only those that carried the
 * fetched response's own nonce — what the browser would have run on a
 * full load is what runs here, nothing more. */
import { readPageNonce } from '../dev/client/cspNonce';
import type {
	DocumentNavigationEventDetail,
	DocumentNavigationOutcome,
	DocumentNavigationType,
	EnableNavigationOptions,
	NavigateDocumentOptions
} from '../../types/navigation';
import { disposeIslandsIn } from './islandDisposers';
import { consumePrefetch } from './prefetch';
import {
	keepRunningScripts,
	liveScriptsByIdentity,
	reusableScript
} from './scriptReuse';

/* Shared by every bundle copy of this module (each framework's client pass
 * bundles its own), and read by the Svelte `<Link>` to decide whether a
 * URL no `<Router>` matches should be handed to the browser. */
import { announcePage, resetFocus } from './navigationFocus';

const RUNTIME_KEY = Symbol.for('absolutejs.navigation');
const STATE_KEY = '__absoluteNavigation';
const OPT_OUT_SELECTOR = '[data-absolute-navigation="off"]';
const MODULE_RUN_PARAM = 'absolute-nav';
const ISLAND_STATE_GLOBAL = '__ABS_ISLAND_STATE__';
const DISPOSE_GLOBAL = '__ABSOLUTE_PAGE_DISPOSE__';
const READY_GLOBAL = '__ABSOLUTE_PAGE_READY__';
const STYLESHEET_TIMEOUT_MS = 5_000;
const PAGE_READY_TIMEOUT_MS = 10_000;
const PAGE_READY_POLL_MS = 16;
const SCRIPT_PLACEHOLDER = 'absolute-navigation-script';
const ID_RADIX = 36;

/* Globals one page's bootstrap writes for its own hydration. Cleared before
 * the next page's scripts run so it never hydrates with the last page's
 * props. `__ABS_ISLAND_STATE__` is deliberately not here: it is the shared
 * island-store snapshot that must survive. */
const PAGE_GLOBALS = [
	'__INITIAL_PROPS__',
	'__SSR_DIRTY__',
	'__ABS_SLOT_HYDRATION_PENDING__',
	'__ABS_SVELTE_LAZY_ROUTES__',
	'__ABS_SVELTE_ISLAND_HTML__',
	'__ABS_SERVER_ISLAND_HTML__',
	'__ABSOLUTE_SERVER_DATA__',
	'__ABS_ANGULAR_REQUEST_CONTEXT__',
	'__ABS_ANGULAR_BASE_HREF__',
	DISPOSE_GLOBAL,
	READY_GLOBAL
];

const JAVASCRIPT_TYPES = new Set([
	'',
	'application/ecmascript',
	'application/javascript',
	'module',
	'speculationrules',
	'text/ecmascript',
	'text/javascript'
]);

type NavigationLike = EventTarget & { currentEntry: unknown };

type ScrollPosition = { left: number; top: number };

/* Which inline scripts / styles of a fetched page may run here. */
type ElementTrust =
	{ kind: 'all' } | { kind: 'none' } | { kind: 'nonce'; nonce: string };

type PendingScript = {
	placeholder: Comment;
	source: HTMLScriptElement;
	trusted: boolean;
};

type HeadContext = {
	available: Map<string, Element[]>;
	preloaded: Set<Element>;
	trust: ElementTrust;
};

type IslandStateRef = { live: Record<string, unknown> | undefined };

type LoadedDocument = {
	document: Document;
	trust: ElementTrust;
	url: URL;
};

type NavigationRequest = {
	/** Document the destination entry belongs to (traversals). */
	documentId?: string;
	/** The Navigation API already committed the entry for this navigation
	 *  (`intercept()`), so the swap stamps the entry it is on instead of
	 *  pushing another one. */
	managedHistory?: boolean;
	replace: boolean;
	/** Scroll position saved for the destination entry (traversals). */
	scroll?: ScrollPosition;
	type: DocumentNavigationType;
	url: URL;
};

type Runtime = {
	controller: AbortController | undefined;
	/** A navigation the click listener looked at and left to the browser,
	 *  so the `navigate` listener does not take it back. See `declineUrl`. */
	declined: { at: number; href: string } | undefined;
	documentId: string;
	/** The layer is handing a navigation to the browser on purpose
	 *  (`reload`), which it does with `location.assign` — itself a
	 *  navigation the `navigate` listener would otherwise intercept, and
	 *  retrying what just failed is a loop. */
	handingOff: boolean;
	entryOwners: Map<string, string>;
	evaluatedModules: Set<string>;
	moduleRun: number;
	navigating: boolean;
	navigationApi: NavigationLike | undefined;
	nonce: string | undefined;
	options: EnableNavigationOptions;
	restoreHistory: (() => void) | undefined;
	scroll: Map<string, ScrollPosition>;
	scrollFrame: number;
	teardown: Array<() => void>;
	token: number;
};

type PublicRuntime = {
	disable: () => void;
	refresh: () => Promise<DocumentNavigationOutcome>;
	navigate: (
		href: string,
		options?: NavigateDocumentOptions
	) => Promise<DocumentNavigationOutcome>;
};

let runtime: Runtime | undefined;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const createId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(ID_RADIX)}-${Math.random().toString(ID_RADIX).slice(2)}`;

const delay = (millis: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, millis);
	});

const readPublicRuntime = () => {
	const value: unknown = Reflect.get(globalThis, RUNTIME_KEY);
	if (!isRecord(value)) return undefined;
	const { disable, navigate } = value;
	if (typeof disable !== 'function' || typeof navigate !== 'function') {
		return undefined;
	}

	return value;
};

const prefersReducedMotion = () =>
	typeof window.matchMedia === 'function' &&
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* History entries: which document owns which entry                    */
/* ------------------------------------------------------------------ */

const isNavigationLike = (value: unknown): value is NavigationLike =>
	typeof value === 'object' &&
	value !== null &&
	'currentEntry' in value &&
	typeof Reflect.get(value, 'addEventListener') === 'function';

const readNavigationApi = () => {
	const value: unknown = Reflect.get(window, 'navigation');

	return isNavigationLike(value) ? value : undefined;
};

const readEntryKey = (api: NavigationLike) => {
	const entry = api.currentEntry;
	if (typeof entry !== 'object' || entry === null) return undefined;
	const key: unknown = Reflect.get(entry, 'key');

	return typeof key === 'string' ? key : undefined;
};

const readStamp = (state: unknown) => {
	if (!isRecord(state)) return undefined;
	const stamp = state[STATE_KEY];
	if (!isRecord(stamp)) return undefined;
	const { doc, key } = stamp;
	if (typeof doc !== 'string' || typeof key !== 'string') return undefined;

	return { doc, key };
};

const isStampable = (state: unknown) => state === null || isRecord(state);

const stampState = (state: unknown, doc: string, key: string) => {
	if (!isStampable(state)) return state;

	return { ...(isRecord(state) ? state : {}), [STATE_KEY]: { doc, key } };
};

/** Key of the history entry the browser is on right now. */
const currentEntryKey = (nav: Runtime) =>
	nav.navigationApi
		? readEntryKey(nav.navigationApi)
		: readStamp(window.history.state)?.key;

/** Document that owns the current entry. `undefined` = unknown. */
const currentEntryOwner = (nav: Runtime) => {
	if (!nav.navigationApi) return readStamp(window.history.state)?.doc;
	const key = readEntryKey(nav.navigationApi);

	return key === undefined ? undefined : nav.entryOwners.get(key);
};

/** A traversal landed on an entry another document wrote. Navigation API:
 *  every entry this session wrote is in the map, so an unknown one is
 *  foreign. History fallback: an entry without a stamp (a hash link, an
 *  entry from before `enableNavigation`) stays with the current page. */
const isForeignEntry = (nav: Runtime) => {
	const owner = currentEntryOwner(nav);
	if (owner === nav.documentId) return false;

	return owner !== undefined || nav.navigationApi !== undefined;
};

const recordCurrentEntry = (nav: Runtime) => {
	if (!nav.navigationApi) return;
	const key = readEntryKey(nav.navigationApi);
	if (key !== undefined) nav.entryOwners.set(key, nav.documentId);
};

/* Navigation API: an entry a router (or a hash link) pushes or replaces
 * belongs to the document on screen. Traversals land on known entries. */
const trackEntries = (nav: Runtime, api: NavigationLike) => {
	const onEntryChange = (event: Event) => {
		if (Reflect.get(event, 'navigationType') === 'traverse') return;
		recordCurrentEntry(nav);
	};
	api.addEventListener('currententrychange', onEntryChange);
	nav.teardown.push(() =>
		api.removeEventListener('currententrychange', onEntryChange)
	);
	recordCurrentEntry(nav);
};

/* History fallback: no entry keys without the Navigation API, so every
 * pushState / replaceState gets a `{ doc, key }` stamp merged into its
 * (object or null) state. Routers keep their own keys next to it. */
const patchHistory = (nav: Runtime) => {
	const { history } = window;
	const originalPush = history.pushState;
	const originalReplace = history.replaceState;
	history.pushState = (
		state: unknown,
		unused: string,
		url?: string | URL | null
	) =>
		Reflect.apply(originalPush, history, [
			stampState(state, nav.documentId, createId()),
			unused,
			url
		]);
	history.replaceState = (
		state: unknown,
		unused: string,
		url?: string | URL | null
	) =>
		Reflect.apply(originalReplace, history, [
			stampState(
				state,
				nav.documentId,
				readStamp(history.state)?.key ?? createId()
			),
			unused,
			url
		]);
	history.replaceState(history.state, '');
	nav.restoreHistory = () => {
		history.pushState = originalPush;
		history.replaceState = originalReplace;
	};
};

/* ------------------------------------------------------------------ */
/* Scroll                                                              */
/* ------------------------------------------------------------------ */

const recordScroll = (nav: Runtime) => {
	if (nav.navigating) return;
	const key = currentEntryKey(nav);
	if (key === undefined) return;
	nav.scroll.set(key, { left: window.scrollX, top: window.scrollY });
};

const trackScroll = (nav: Runtime) => {
	const onScroll = () => {
		if (nav.scrollFrame !== 0) return;
		nav.scrollFrame = window.requestAnimationFrame(() => {
			nav.scrollFrame = 0;
			recordScroll(nav);
		});
	};
	window.addEventListener('scroll', onScroll, { passive: true });
	nav.teardown.push(() => {
		window.removeEventListener('scroll', onScroll);
		if (nav.scrollFrame !== 0) window.cancelAnimationFrame(nav.scrollFrame);
	});
};

const scrollToHash = (hash: string) => {
	if (hash === '' || hash === '#') return false;
	const id = decodeURIComponent(hash.slice(1));
	const target =
		document.getElementById(id) ?? document.getElementsByName(id)[0];
	if (!target) return false;
	target.scrollIntoView();

	return true;
};

const applyScroll = (request: NavigationRequest, url: URL) => {
	if (request.scroll) {
		window.scrollTo(request.scroll.left, request.scroll.top);

		return;
	}
	if (scrollToHash(url.hash)) return;
	window.scrollTo(0, 0);
};

/* Hydrating a document root can put the window back at the top (seen with
 * React 19 on `document`). Once the page is up, a position that was reset
 * to 0 is applied again; a position the user scrolled to stays. */
const reapplyScroll = (request: NavigationRequest, url: URL) => {
	if (window.scrollY !== 0 || window.scrollX !== 0) return;
	if (request.scroll && request.scroll.top + request.scroll.left > 0) {
		window.scrollTo(request.scroll.left, request.scroll.top);

		return;
	}
	if (!request.scroll) scrollToHash(url.hash);
};

/* ------------------------------------------------------------------ */
/* Modules: re-run a page's entry when it is visited again             */
/* ------------------------------------------------------------------ */

const RELATIVE_SPECIFIER = /^(?:\/|\.\.?\/|https?:)/;
const IMPORT_CALL_RE = /\bimport\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const IMPORT_FROM_RE = /\b(from|import)\s*(["'])([^"'\n]+)\2/g;

const resolveSameOrigin = (specifier: string) => {
	if (!RELATIVE_SPECIFIER.test(specifier)) return undefined;
	try {
		const url = new URL(specifier, window.location.href);

		return url.origin === window.location.origin ? url : undefined;
	} catch {
		return undefined;
	}
};

/* A module URL evaluates once per document, so a page's hydration index
 * that already ran (the user is coming back to it) would be a no-op. Give
 * the revisit a fresh URL; its imports (framework vendor chunks, shared
 * chunks) keep their URLs, so only the entry re-runs. */
const moduleUrlFor = (nav: Runtime, specifier: string) => {
	const url = resolveSameOrigin(specifier);
	if (!url) return specifier;
	if (!nav.evaluatedModules.has(url.href)) {
		nav.evaluatedModules.add(url.href);

		return specifier;
	}
	nav.moduleRun += 1;
	url.searchParams.set(MODULE_RUN_PARAM, String(nav.moduleRun));

	return url.href;
};

const rewriteModuleSpecifiers = (nav: Runtime, source: string) =>
	source
		.replace(
			IMPORT_CALL_RE,
			(_match, _quote: string, specifier: string) =>
				`import(${JSON.stringify(moduleUrlFor(nav, specifier))})`
		)
		.replace(
			IMPORT_FROM_RE,
			(match, keyword: string, _quote: string, specifier: string) =>
				resolveSameOrigin(specifier)
					? `${keyword} ${JSON.stringify(moduleUrlFor(nav, specifier))}`
					: match
		);

const rememberSpecifier = (nav: Runtime, specifier: string) => {
	const url = resolveSameOrigin(specifier);
	if (url) nav.evaluatedModules.add(url.href);
};

const rememberImportCalls = (nav: Runtime, text: string) => {
	for (const match of text.matchAll(IMPORT_CALL_RE)) {
		rememberSpecifier(nav, match[2] ?? '');
	}
};

/** The entries the current document already evaluated. */
const rememberDocumentModules = (nav: Runtime) => {
	for (const script of Array.from(document.scripts)) {
		const src = script.getAttribute('src');
		if (src && script.type === 'module') rememberSpecifier(nav, src);
		rememberImportCalls(nav, script.textContent ?? '');
	}
};

/* ------------------------------------------------------------------ */
/* Fetching and parsing                                                */
/* ------------------------------------------------------------------ */

const TRUST_ALL: ElementTrust = { kind: 'all' };
const TRUST_NONE: ElementTrust = { kind: 'none' };

const readTrust = (response: Response) => {
	const policy = response.headers.get('content-security-policy');
	if (!policy) return TRUST_ALL;
	const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
	if (!nonce) return TRUST_NONE;
	const trust: ElementTrust = { kind: 'nonce', nonce };

	return trust;
};

const isTrusted = (element: Element, trust: ElementTrust) => {
	if (trust.kind === 'all') return true;
	if (trust.kind === 'none') return false;

	return element.getAttribute('nonce') === trust.nonce;
};

const takePrefetched = async (url: URL) => {
	const pending =
		consumePrefetch(url.href) ??
		consumePrefetch(`${url.pathname}${url.search}`);
	if (!pending) return undefined;
	const response = await pending;

	return response.ok ? response : undefined;
};

/* A refresh exists because the page's data changed, so it may not be
 * answered from anything fetched before that: not a prefetched copy of
 * this page (taken here and dropped, or the next visit would be served
 * the stale one), and not the HTTP cache. */
const fetchFreshDocument = async (url: URL, signal: AbortSignal) => {
	const stale = await takePrefetched(url).catch(() => undefined);
	await stale?.body?.cancel().catch(() => undefined);

	return fetch(url.href, {
		cache: 'reload',
		credentials: 'same-origin',
		headers: { Accept: 'text/html' },
		signal
	});
};

const fetchDocument = async (url: URL, signal: AbortSignal) =>
	(await takePrefetched(url)) ??
	fetch(url.href, {
		credentials: 'same-origin',
		headers: { Accept: 'text/html' },
		signal
	});

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* DOMParser documents inherit this document's CSP, so a parsed <style>
 * carrying the fetched response's nonce is reported as a violation the
 * moment it is parsed. Elements carrying that response's nonce (what a full
 * load would have run) get this document's nonce before parsing; nothing
 * else gains one. */
const adoptResponseNonce = (
	nav: Runtime,
	html: string,
	trust: ElementTrust
) => {
	if (trust.kind !== 'nonce' || !nav.nonce) return { html, trust };
	const pattern = new RegExp(
		`\\bnonce=(["'])${escapeRegExp(trust.nonce)}\\1`,
		'g'
	);
	const adopted: ElementTrust = { kind: 'nonce', nonce: nav.nonce };

	return {
		html: html.replace(pattern, `nonce="${nav.nonce}"`),
		trust: adopted
	};
};

const loadDocument = async (
	nav: Runtime,
	url: URL,
	signal: AbortSignal,
	fresh: boolean
) => {
	const response = await (fresh
		? fetchFreshDocument(url, signal)
		: fetchDocument(url, signal));
	const contentType = response.headers.get('content-type') ?? '';
	const finalUrl = new URL(response.url || url.href);
	finalUrl.hash = url.hash;
	if (
		!response.ok ||
		!contentType.includes('text/html') ||
		finalUrl.origin !== window.location.origin
	) {
		await response.body?.cancel().catch(() => undefined);

		return undefined;
	}
	const { html, trust } = adoptResponseNonce(
		nav,
		await response.text(),
		readTrust(response)
	);
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	const loaded: LoadedDocument = {
		document: parsed,
		trust,
		url: finalUrl
	};

	return loaded;
};

const isExecutableScript = (script: HTMLScriptElement) =>
	JAVASCRIPT_TYPES.has(
		(script.getAttribute('type') ?? '').trim().toLowerCase()
	);

/* Swap each executable <script> for a comment so the parsed (inert)
 * elements never reach the live document; the comment marks where the
 * recreated script goes. */
const extractScripts = (loaded: LoadedDocument) =>
	Array.from(loaded.document.querySelectorAll('script'))
		.filter(isExecutableScript)
		.map((source) => {
			const placeholder =
				loaded.document.createComment(SCRIPT_PLACEHOLDER);
			const trusted = isTrusted(source, loaded.trust);
			source.replaceWith(placeholder);
			const pending: PendingScript = { placeholder, source, trusted };

			return pending;
		});

/* ------------------------------------------------------------------ */
/* Stylesheets, head and body                                          */
/* ------------------------------------------------------------------ */

const applyNonce = (nav: Runtime, element: Element, trusted: boolean) => {
	element.removeAttribute('nonce');
	// The attribute (not just the property) so later readers of the page
	// nonce (`script[nonce], style[nonce]`) still find a carrier.
	if (trusted && nav.nonce) element.setAttribute('nonce', nav.nonce);
};

const waitForStylesheet = (link: HTMLLinkElement) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, STYLESHEET_TIMEOUT_MS);
		const done = () => {
			clearTimeout(timer);
			resolve();
		};
		link.addEventListener('load', done, { once: true });
		link.addEventListener('error', done, { once: true });
	});

/* Load the target's stylesheets before anything is torn down, inert
 * (`media="not all"`) so they can't restyle the page still on screen. */
const preloadStylesheets = async (loaded: LoadedDocument) => {
	const links = Array.from(
		loaded.document.head.querySelectorAll<HTMLLinkElement>(
			'link[rel~="stylesheet"]'
		)
	);
	const media = new Map<HTMLLinkElement, string | null>();
	for (const link of links) {
		media.set(link, link.getAttribute('media'));
		link.setAttribute('media', 'not all');
		document.head.append(document.adoptNode(link));
	}
	await Promise.all(links.map(waitForStylesheet));

	return media;
};

const restoreMedia = (media: Map<HTMLLinkElement, string | null>) => {
	for (const [link, value] of media) {
		if (value === null) link.removeAttribute('media');
		else link.setAttribute('media', value);
	}
};

const elementKey = (element: Element) => {
	const attributes = Array.from(element.attributes)
		.filter((attribute) => attribute.name !== 'nonce')
		.map((attribute) => `${attribute.name}=${attribute.value}`)
		.sort()
		.join('\u0000');

	return `${element.tagName}\u0001${attributes}\u0001${element.textContent ?? ''}`;
};

const takeMatch = (available: Map<string, Element[]>, node: Element) =>
	available.get(elementKey(node))?.shift();

const syncAttributes = (target: Element, source: Element) => {
	for (const attribute of Array.from(target.attributes)) {
		if (!source.hasAttribute(attribute.name))
			target.removeAttribute(attribute.name);
	}
	for (const attribute of Array.from(source.attributes)) {
		target.setAttribute(attribute.name, attribute.value);
	}
};

const indexHead = (preloaded: Set<Element>) => {
	const available = new Map<string, Element[]>();
	for (const child of Array.from(document.head.children)) {
		if (preloaded.has(child) || child.tagName === 'SCRIPT') continue;
		const key = elementKey(child);
		available.set(key, [...(available.get(key) ?? []), child]);
	}

	return available;
};

const resolveHeadNode = (nav: Runtime, node: Node, context: HeadContext) => {
	if (!(node instanceof Element) || context.preloaded.has(node)) return node;
	const existing = takeMatch(context.available, node);
	if (existing) return existing;
	if (node.tagName === 'STYLE') {
		applyNonce(nav, node, isTrusted(node, context.trust));
	}

	return document.adoptNode(node);
};

/* Keep head elements the two pages share (same tag, attributes and text):
 * no stylesheet reload, no favicon flash. Everything else is replaced.
 * Every node is kept in order, whitespace text and comments included:
 * Svelte hydrates `<svelte:head>` by walking those nodes, and a missing one
 * makes it throw the server markup away and mount again. */
const swapHead = (
	nav: Runtime,
	loaded: LoadedDocument,
	headNodes: Node[],
	preloaded: Set<Element>
) => {
	const context: HeadContext = {
		available: indexHead(preloaded),
		preloaded,
		trust: loaded.trust
	};
	const nextNodes = headNodes.map((node) =>
		resolveHeadNode(nav, node, context)
	);
	syncAttributes(document.head, loaded.document.head);
	document.head.replaceChildren(...nextNodes);
};

const swapBody = (nav: Runtime, loaded: LoadedDocument) => {
	for (const style of Array.from(
		loaded.document.body.querySelectorAll('style')
	)) {
		applyNonce(nav, style, isTrusted(style, loaded.trust));
	}
	const nextBody = document.adoptNode(loaded.document.body);
	document.body.replaceWith(nextBody);
};

/* ------------------------------------------------------------------ */
/* Persisted islands (phase 5)                                         */
/* ------------------------------------------------------------------ */

/* An island rendered with `persist="<key>"` keeps running across a
 * navigation when the page being swapped in renders an island with the
 * same key: the live element is moved into the incoming document in place
 * of its twin, so the instance mounted into it — its React root, Svelte
 * instance, Vue app or Angular component — is never unmounted and never
 * hydrated again. Its DOM state comes with it: what was typed into it, an
 * open menu, a playing video, a scrolled list.
 *
 * An island is the unit rather than an arbitrary subtree, which is what
 * the phase's first design asked for, because an island is already the
 * one thing every framework's hydration leaves alone: React renders its
 * host with `suppressHydrationWarning` and no children, and a Svelte
 * island slot writes only when it is empty (beta.252). A subtree of
 * page-owned markup has no such protection — the page app is unmounted on
 * every navigation, so persisting markup it owns would keep nodes whose
 * component is gone.
 *
 * A key the incoming page does not render is NOT persisted: a layout the
 * next page never asked for has to be torn down with the rest, or this is
 * the island leak of beta.234 with a nicer name. */
const PERSIST_ATTRIBUTE = 'data-absolute-persist';
const PERSIST_SELECTOR = `[${PERSIST_ATTRIBUTE}][data-island="true"]`;

type PersistedIsland = { incoming: Element; live: Element };

const collectPersisted = (root: ParentNode) => {
	const found = new Map<string, Element>();
	for (const element of Array.from(root.querySelectorAll(PERSIST_SELECTOR))) {
		const key = element.getAttribute(PERSIST_ATTRIBUTE) ?? '';
		// First wins, so a repeated key is a no-op rather than a surprise
		// about which of the two moved.
		if (key !== '' && !found.has(key)) found.set(key, element);
	}

	return found;
};

const matchPersistedIslands = (loaded: LoadedDocument) => {
	const incoming = collectPersisted(loaded.document.body);
	if (incoming.size === 0) return [];
	const pairs: PersistedIsland[] = [];
	for (const [key, live] of collectPersisted(document.body)) {
		const twin = incoming.get(key);
		if (twin) pairs.push({ incoming: twin, live });
	}

	return pairs;
};

const isPersisted = (pairs: PersistedIsland[], element: Element) =>
	pairs.some(({ live }) => live === element || live.contains(element));

/* Into the incoming body, which the caller is about to make the live one:
 * the island goes straight from one body to the other rather than sitting
 * detached in between. */
const movePersistedIslands = (
	pairs: PersistedIsland[],
	loaded: LoadedDocument
) => {
	for (const { incoming, live } of pairs) {
		incoming.replaceWith(loaded.document.adoptNode(live));
	}
};

const disposeCurrentPage = async () => {
	const dispose: unknown = Reflect.get(window, DISPOSE_GLOBAL);
	Reflect.set(window, DISPOSE_GLOBAL, undefined);
	Reflect.set(window, READY_GLOBAL, undefined);
	if (typeof dispose === 'function') await Reflect.apply(dispose, window, []);
};

const canTearDown = () =>
	typeof Reflect.get(window, DISPOSE_GLOBAL) === 'function';

/* A page with no framework app to tear down.
 *
 * `canTearDown()` gates the whole layer: a page that registers no
 * `__ABSOLUTE_PAGE_DISPOSE__` falls back to a full document load. That is
 * right for a framework page whose hydration index never finished — there
 * is a half-mounted app whose markup must not be swapped out from under
 * it — and wrong for a static HTML or HTMX page, where there is nothing to
 * tear down at all. The result was that every link from a static page did
 * a full load, and a React → HTML → React trip soft-navigated once and
 * then reloaded, so static pages could be navigated *to* and never *from*.
 *
 * Registering a no-op is what lets them take part (navigation plan phase
 * 2). It never replaces a real hook, and the two cannot race on a
 * framework page: an index registers its hook at module evaluation, and
 * `enableNavigation()` is documented to be called from a component (a
 * React effect, a Svelte `onMount`), which by definition runs after that. */
const markPageWithoutTeardown = () => {
	if (canTearDown()) return;
	Reflect.set(window, DISPOSE_GLOBAL, () => undefined);
};

/* ------------------------------------------------------------------ */
/* Scripts                                                             */
/* ------------------------------------------------------------------ */

const islandStateOf = (value: unknown) => (isRecord(value) ? value : undefined);

/* A page with islands re-seeds `window.__ABS_ISLAND_STATE__` with the
 * server's store state. The live snapshot wins per store, the same rule
 * `initializeIslandStores` applies. */
const keepIslandState = (live: Record<string, unknown> | undefined) => {
	const current = islandStateOf(Reflect.get(globalThis, ISLAND_STATE_GLOBAL));
	if (!live || current === live) return live;
	const merged: Record<string, unknown> = { ...(current ?? {}), ...live };
	Reflect.set(globalThis, ISLAND_STATE_GLOBAL, merged);

	return merged;
};

const loadEvent = (script: HTMLScriptElement) =>
	new Promise<void>((resolve) => {
		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener('error', () => resolve(), { once: true });
	});

const createScript = (nav: Runtime, pending: PendingScript) => {
	const { source } = pending;
	const script = document.createElement('script');
	Array.from(source.attributes)
		.filter(({ name }) => name !== 'nonce' && name !== 'src')
		.forEach(({ name, value }) => script.setAttribute(name, value));
	applyNonce(nav, script, pending.trusted);
	const src = source.getAttribute('src');
	const isModule = source.type === 'module';
	if (src) script.src = isModule ? moduleUrlFor(nav, src) : src;
	if (!src) script.text = rewriteModuleSpecifiers(nav, source.text);
	if (src && !source.hasAttribute('async')) script.async = false;

	return script;
};

const runScript = async (
	nav: Runtime,
	pending: PendingScript,
	islandState: IslandStateRef,
	live: Map<string, HTMLScriptElement>
) => {
	if (!pending.placeholder.isConnected) return;
	/* A third-party script the live document is already running is moved
	 * into the new page rather than recreated, which would run it again.
	 * See client/scriptReuse.ts for why this is keyed on an identity
	 * marker and not on `src`. */
	const running = reusableScript(live, pending.source);
	if (running !== undefined) {
		pending.placeholder.replaceWith(running);

		return;
	}
	const script = createScript(nav, pending);
	const loaded = script.src ? loadEvent(script) : Promise.resolve();
	pending.placeholder.replaceWith(script);
	islandState.live = keepIslandState(islandState.live);
	await loaded;
	islandState.live = keepIslandState(islandState.live);
};

const clearPageGlobals = () => {
	for (const name of PAGE_GLOBALS) Reflect.deleteProperty(window, name);
};

/* In document order, one at a time: an inline script that sets
 * `__INITIAL_PROPS__` has to run before the module that hydrates with it. */
const runScripts = (
	nav: Runtime,
	scripts: PendingScript[],
	live: Map<string, HTMLScriptElement>
) => {
	const islandState: IslandStateRef = {
		live: islandStateOf(Reflect.get(globalThis, ISLAND_STATE_GLOBAL))
	};

	return scripts.reduce<Promise<void>>(
		(previous, pending) =>
			previous.then(() => runScript(nav, pending, islandState, live)),
		Promise.resolve()
	);
};

const pollForPage = async (deadline: number): Promise<void> => {
	if (canTearDown() || Date.now() >= deadline) return;
	await delay(PAGE_READY_POLL_MS);
	await pollForPage(deadline);
};

/* The hydration index registers `__ABSOLUTE_PAGE_DISPOSE__` once it has
 * mounted — possibly after an `import()` an inline bootstrap started. */
const waitForPageReady = async (hasModules: boolean) => {
	if (hasModules) await pollForPage(Date.now() + PAGE_READY_TIMEOUT_MS);
	const ready: unknown = Reflect.get(window, READY_GLOBAL);
	if (ready instanceof Promise) await ready.catch(() => undefined);
};

const loadsModules = (scripts: PendingScript[]) =>
	scripts.some(
		({ source }) =>
			source.type === 'module' || /\bimport\s*\(/.test(source.text)
	);

/* ------------------------------------------------------------------ */
/* Focus, announcement, events                                         */
/* ------------------------------------------------------------------ */

const dispatch = (
	name: string,
	detail: DocumentNavigationEventDetail,
	cancelable: boolean
) => window.dispatchEvent(new CustomEvent(name, { cancelable, detail }));

/* ------------------------------------------------------------------ */
/* The navigation                                                      */
/* ------------------------------------------------------------------ */

const outcome = (value: DocumentNavigationOutcome) => value;

const reload = (
	nav: Runtime,
	request: NavigationRequest,
	committed: boolean
) => {
	/* Every branch below is a navigation the `navigate` listener would see
	 * and intercept, which would hand the failure straight back to the
	 * code that just failed. */
	nav.handingOff = true;
	/* A refresh reloads rather than `replace`s its own address: with a
	 * `#fragment` in it, replacing a URL with itself is a same-document
	 * navigation and fetches nothing. */
	if (committed || request.type === 'traverse' || request.type === 'refresh')
		window.location.reload();
	else if (request.replace) window.location.replace(request.url.href);
	else window.location.assign(request.url.href);

	return outcome('reloaded');
};

/** Save the scroll position of the entry being left, so a later back
 *  restores it. Separate from `commitHistory` because a Navigation API
 *  interception commits its entry the moment `intercept()` is called:
 *  by the time the swap runs, the current entry is already the
 *  destination, and the position would be filed under the wrong key. */
const rememberScroll = (nav: Runtime) => {
	const key = currentEntryKey(nav);
	if (key === undefined) return;
	nav.scroll.set(key, { left: window.scrollX, top: window.scrollY });
};

const commitHistory = (nav: Runtime, request: NavigationRequest, url: URL) => {
	nav.documentId = request.documentId ?? createId();
	if (request.type === 'traverse') {
		recordCurrentEntry(nav);

		return;
	}
	const state = stampState(null, nav.documentId, createId());
	/* The Navigation API pushed the entry already, so this stamps the one
	 * we are on rather than adding a second. `replaceState` with the
	 * loaded URL also settles a redirect: the entry carries the URL asked
	 * for, and this is where the URL arrived at goes. */
	if (request.managedHistory) {
		window.history.replaceState(state, '', url.href);
		recordCurrentEntry(nav);

		return;
	}
	rememberScroll(nav);
	if (request.replace) window.history.replaceState(state, '', url.href);
	else window.history.pushState(state, '', url.href);
	recordCurrentEntry(nav);
};

const shouldAnimate = (nav: Runtime) =>
	nav.options.viewTransition !== false &&
	typeof Reflect.get(document, 'startViewTransition') === 'function' &&
	!prefersReducedMotion();

const readPromise = (value: unknown, name: string) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const promise: unknown = Reflect.get(value, name);

	return promise instanceof Promise ? promise : undefined;
};

const runSwap = async (
	nav: Runtime,
	swap: () => Promise<void>,
	animate: boolean
) => {
	const start: unknown = Reflect.get(document, 'startViewTransition');
	if (!animate || !shouldAnimate(nav) || typeof start !== 'function') {
		await swap();

		return;
	}
	const transition: unknown = Reflect.apply(start, document, [swap]);
	readPromise(transition, 'ready')?.catch(() => undefined);
	readPromise(transition, 'finished')?.catch(() => undefined);
	await readPromise(transition, 'updateCallbackDone');
};

const restoreFocus = (focusedId: string | undefined) => {
	if (!focusedId) return false;
	const again = document.getElementById(focusedId);
	again?.focus({ preventScroll: true });

	return again !== null;
};

const swapDocument = async (
	nav: Runtime,
	request: NavigationRequest,
	loaded: LoadedDocument,
	isStale: () => boolean
) => {
	const scripts = extractScripts(loaded);
	/* Before the head is swapped, which discards the live nodes: a
	 * third-party script the incoming page also carries is carried over
	 * from here rather than recreated. */
	const liveScripts = liveScriptsByIdentity(document);
	// Before the preload moves the stylesheet links out of the parsed head.
	const headNodes = Array.from(loaded.document.head.childNodes);
	const media = await preloadStylesheets(loaded);
	const preloaded = new Set<Element>(media.keys());
	// A newer navigation started while the stylesheets loaded: it owns the
	// page now, so drop what this one added and stop.
	if (isStale()) {
		preloaded.forEach((link) => link.remove());

		return false;
	}
	// Outside the View Transition callback: the browser records the scroll
	// position of the entry being left when the new one is pushed, and inside
	// the callback it reads 0, which it then restores on a later back.
	commitHistory(nav, request, loaded.url);
	/* Islands both pages render with the same `persist` key, matched before
	 * anything is torn down. */
	const persisted = matchPersistedIslands(loaded);
	const swap = async () => {
		// Islands first, then the page: a framework page root may own the
		// markup an island is mounted into, so tearing the page down first
		// detaches the island's host element and the island then unmounts
		// against nodes that are already gone.
		await disposeIslandsIn(document.body, (element) =>
			isPersisted(persisted, element)
		);
		await disposeCurrentPage();
		clearPageGlobals();
		syncAttributes(
			document.documentElement,
			loaded.document.documentElement
		);
		swapHead(nav, loaded, headNodes, preloaded);
		movePersistedIslands(persisted, loaded);
		swapBody(nav, loaded);
		restoreMedia(media);
		applyScroll(request, loaded.url);
	};
	/* A refresh is the same page with newer data. It is not animated —
	 * a cross-fade between two copies of one page is a flicker — and it
	 * is not a new page to a keyboard or screen reader user either: focus
	 * goes back to where it was when that element is still there, and
	 * nothing is announced. */
	const refreshing = request.type === 'refresh';
	const focusedId = refreshing ? document.activeElement?.id : undefined;
	await runSwap(nav, swap, !refreshing);
	const focusMoved = refreshing ? restoreFocus(focusedId) : resetFocus();
	/* Before the incoming page's scripts run, not after: a `lazyOnload`
	 * bootstrap checks the document for its tag on a timer, and
	 * `runScripts` awaits each module's load event — so appending
	 * afterwards lost that race and the script was added twice. */
	keepRunningScripts(
		liveScripts,
		scripts.map((pending) => pending.source)
	);
	await runScripts(nav, scripts, liveScripts);
	/* Before waiting, not after: nothing on a page with no framework app
	 * will ever register a teardown hook, and `waitForPageReady` spends
	 * the whole poll deadline finding that out. Marked after it, a static
	 * page stayed unswappable for seconds — long enough that a click in
	 * that window did a full document load, which is what a visitor does.
	 *
	 * The test is `__ABSOLUTE_PAGE_READY__`, not "does it load modules".
	 * Every framework hydration index sets READY as its module evaluates,
	 * which has already happened in `runScripts` above, so READY without
	 * DISPOSE means an index is booting or failed — and there the
	 * conservative full load is right, because a half-mounted app must not
	 * have its markup swapped out. Neither set means there is no framework
	 * app at all.
	 *
	 * Module scripts were the first signal used here and they were wrong:
	 * a static page carrying islands has one — the island bootstrap — so
	 * it read as a framework page, never became swappable, and could be
	 * navigated to but not from.
	 *
	 * A page whose inline bootstrap `import()`s its index asynchronously
	 * has neither global set at this point, so it is marked too. That is
	 * safe: `markPageWithoutTeardown` never replaces a real hook, and the
	 * index overwrites the no-op with its own when it evaluates. */
	if (Reflect.get(window, READY_GLOBAL) === undefined && !canTearDown())
		markPageWithoutTeardown();
	await waitForPageReady(loadsModules(scripts));
	reapplyScroll(request, loaded.url);
	if (!refreshing) announcePage(focusMoved);

	return true;
};

const isCurrent = (nav: Runtime, token: number) => nav.token === token;

/* ------------------------------------------------------------------ */

/* The `loading` convention, shown while a soft navigation is in flight.
 *
 * Until now a click had no feedback at all: the layer fetched the next
 * document and swapped it, and the page sat unchanged in between. The
 * convention's markup is appended to the body and removed when the
 * navigation finishes, so the live page — and any persisted island in it
 * — is untouched. Positioning is the app's: it styles its own indicator.
 *
 * Shown only after a delay, because most swaps are faster than the eye
 * and a flash of a spinner reads as jank rather than progress. Fetched
 * once per session and remembered, including the "this app has none"
 * answer, so a 204 means the layer stops asking.
 *
 * Inserted with `innerHTML`, so a `<script>` in a loading convention does
 * NOT run — an indicator has no business needing one, and that is the
 * safer default for markup being injected into a live document. Styles do
 * apply, and the live document's CSP nonce is stamped onto them here
 * because the server strips the request-time one before caching. */
const LOADING_INDICATOR_PATH = '/__absolute/loading';
const LOADING_INDICATOR_ATTRIBUTE = 'data-absolute-loading';
const LOADING_INDICATOR_DELAY_MS = 150;
const LOADING_INDICATOR_EMPTY = 204;

let loadingMarkup: Promise<string | null> | undefined;

const fetchLoadingMarkup = () =>
	(loadingMarkup ??= fetch(LOADING_INDICATOR_PATH, {
		headers: { accept: 'text/html' }
	})
		.then((response) =>
			response.status === LOADING_INDICATOR_EMPTY || !response.ok
				? null
				: response.text()
		)
		.catch(() => null));

const removeLoadingIndicator = () => {
	for (const host of Array.from(
		document.querySelectorAll(`[${LOADING_INDICATOR_ATTRIBUTE}]`)
	)) {
		host.remove();
	}
};

const showLoadingIndicator = async (nav: Runtime, isStale: () => boolean) => {
	const markup = await fetchLoadingMarkup();
	// The navigation may have finished while this was in flight, and a
	// second one may have started: either way there is nothing to show.
	if (markup === null || isStale()) return;
	if (document.querySelector(`[${LOADING_INDICATOR_ATTRIBUTE}]`)) return;
	const host = document.createElement('div');
	host.setAttribute(LOADING_INDICATOR_ATTRIBUTE, '');
	host.innerHTML = markup;
	for (const styled of Array.from(host.querySelectorAll('style'))) {
		applyNonce(nav, styled, true);
	}
	document.body.append(host);
};

/** Starts the delay; the returned function cancels it and clears the
 *  indicator, whichever of the two is still pending. */
const startLoadingIndicator = (nav: Runtime, isStale: () => boolean) => {
	const timer = setTimeout(() => {
		void showLoadingIndicator(nav, isStale);
	}, LOADING_INDICATOR_DELAY_MS);

	return () => {
		clearTimeout(timer);
		/* Only the navigation still in charge clears the indicator. A
		 * superseded one must not: the navigation that replaced it may
		 * already be showing its own, and `removeLoadingIndicator` is a
		 * document-wide query that cannot tell them apart. The replacing
		 * navigation clears any leftover when it starts. */
		if (!isStale()) removeLoadingIndicator();
	};
};

const performNavigation = async (nav: Runtime, request: NavigationRequest) => {
	nav.token += 1;
	const { token } = nav;
	/* Whatever a previous navigation left behind goes now, before this one
	 * decides whether to show its own. A navigation that is cancelled or
	 * refused below would otherwise inherit a stale indicator. */
	removeLoadingIndicator();
	nav.controller?.abort();
	const controller = new AbortController();
	nav.controller = controller;
	const detail: DocumentNavigationEventDetail = {
		type: request.type,
		url: request.url.href
	};
	const proceed = dispatch(
		'absolute:before-navigate',
		detail,
		request.type !== 'traverse'
	);
	if (!proceed) return outcome('cancelled');
	if (!canTearDown()) return reload(nav, request, false);

	const committedBefore = nav.documentId;
	const stopLoadingIndicator = startLoadingIndicator(
		nav,
		() => !isCurrent(nav, token)
	);
	try {
		const loaded = await loadDocument(
			nav,
			request.url,
			controller.signal,
			request.type === 'refresh'
		);
		if (!isCurrent(nav, token)) return outcome('superseded');
		if (!loaded) return reload(nav, request, false);
		nav.navigating = true;
		const swapped = await swapDocument(
			nav,
			request,
			loaded,
			() => !isCurrent(nav, token)
		);
		if (!swapped) return outcome('superseded');
		dispatch('absolute:after-navigate', detail, false);

		return outcome('swapped');
	} catch (error) {
		if (!isCurrent(nav, token)) return outcome('superseded');
		console.error('[absolute] navigation failed, loading the page:', error);

		return reload(nav, request, nav.documentId !== committedBefore);
	} finally {
		/* Cleared whatever the outcome — swapped, superseded, cancelled or
		 * thrown. A superseded navigation leaves the indicator to the one
		 * that replaced it, which started its own. */
		stopLoadingIndicator();
		if (isCurrent(nav, token)) nav.navigating = false;
	}
};

/* ------------------------------------------------------------------ */
/* Interception                                                        */
/* ------------------------------------------------------------------ */

const isModifiedClick = (event: MouseEvent) =>
	event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const isSamePageFragment = (url: URL) =>
	url.hash !== '' &&
	url.pathname === window.location.pathname &&
	url.search === window.location.search;

const findAnchor = (event: MouseEvent) => {
	const { target } = event;
	if (!(target instanceof Element)) return null;

	return target.closest<HTMLAnchorElement>('a[href]');
};

const isPlainClick = (event: MouseEvent) =>
	!event.defaultPrevented && event.button === 0 && !isModifiedClick(event);

const isOptedOut = (anchor: HTMLAnchorElement) =>
	(anchor.target !== '' && anchor.target !== '_self') ||
	anchor.hasAttribute('download') ||
	anchor.relList.contains('external') ||
	anchor.closest(OPT_OUT_SELECTOR) !== null;

const interceptableUrl = (nav: Runtime, anchor: HTMLAnchorElement) => {
	if (isOptedOut(anchor)) return undefined;
	const url = new URL(anchor.href, window.location.href);
	if (url.origin !== window.location.origin) return undefined;
	if (isSamePageFragment(url)) return undefined;
	if (nav.options.shouldIntercept?.(url) === false) return undefined;

	return url;
};

/* How long a decline stands. The `navigate` event for a click fires as
 * part of the click's default action, so the two are a few microtasks
 * apart; the window only has to be longer than that and shorter than a
 * person clicking twice. */
const DECLINE_WINDOW_MS = 250;

/** Remember that the click listener looked at this URL and chose to leave
 *  it to the browser — an opted-out link, a `download`, a `target`, a
 *  `shouldIntercept` that said no.
 *
 *  Without this the `navigate` listener below would take the navigation
 *  the click listener deliberately let go: `data-absolute-navigation="off"`
 *  would stop meaning anything in a browser with the Navigation API. The
 *  listener does also check the event's `sourceElement`, which answers
 *  the same question more directly — but that property is newer than the
 *  API itself, so it cannot be the only answer. */
const declineUrl = (nav: Runtime, url: URL) => {
	nav.declined = { at: Date.now(), href: url.href };
};

const wasDeclined = (nav: Runtime, url: URL) =>
	nav.declined !== undefined &&
	nav.declined.href === url.href &&
	Date.now() - nav.declined.at < DECLINE_WINDOW_MS;

/* Bubble phase on window: runs after every framework router's handler, so
 * a click a router handled (`preventDefault`) never reaches this. */
const listenForClicks = (nav: Runtime) => {
	const onClick = (event: MouseEvent) => {
		if (!isPlainClick(event)) return;
		const anchor = findAnchor(event);
		if (!anchor) return;
		const url = interceptableUrl(nav, anchor);
		if (!url) {
			declineUrl(nav, new URL(anchor.href, window.location.href));

			return;
		}
		if (!canTearDown()) {
			declineUrl(nav, url);

			return;
		}
		event.preventDefault();
		void performNavigation(nav, { replace: false, type: 'link', url });
	};
	window.addEventListener('click', onClick);
	nav.teardown.push(() => window.removeEventListener('click', onClick));
};

/* Capture phase, so it runs before the routers' popstate listeners: a
 * traversal onto another document's entry is stopped here and swapped. */
const listenForTraversals = (nav: Runtime) => {
	const onPopState = (event: PopStateEvent) => {
		if (!isForeignEntry(nav)) return;
		event.stopImmediatePropagation();
		const owner = currentEntryOwner(nav);
		const key = currentEntryKey(nav);
		void performNavigation(nav, {
			documentId: owner,
			replace: false,
			scroll: key === undefined ? undefined : nav.scroll.get(key),
			type: 'traverse',
			url: new URL(window.location.href)
		});
	};
	window.addEventListener('popstate', onPopState, { capture: true });
	nav.teardown.push(() =>
		window.removeEventListener('popstate', onPopState, { capture: true })
	);
};

/* ------------------------------------------------------------------ */
/* Interception: navigations that are not clicks                       */
/* ------------------------------------------------------------------ */

/* A form submission and a `location.assign()` never reach a click
 * listener, so without this they reload the document — and an app that
 * submits a search form pays for a fresh document, and loses its island
 * state, on a navigation that could have been a swap. The Navigation
 * API's `navigate` event sees both, and `intercept()` is how a page takes
 * one over.
 *
 * Only there: Safari and Firefox have no Navigation API yet, where the
 * click and popstate listeners above are the whole story and a form still
 * loads a document. That is the documented floor, not a regression —
 * nothing a link does depends on this.
 *
 * A click is NOT handled here. The click listener runs first and either
 * prevents the default (so no `navigate` event ever fires) or records a
 * decline, which this skips. Keeping clicks there keeps `download`,
 * `target`, `rel="external"` and `data-absolute-navigation="off"` read
 * off the anchor, where they live. */

type NavigateIntent = {
	intercept: (options: unknown) => void;
	replace: boolean;
	source: Element | undefined;
	url: URL;
};

/** The destination URL, and only for a navigation that would LOAD a
 *  document (`sameDocument === false`).
 *
 *  That one property is what makes this listener safe, and it took a
 *  browser to find out: `history.pushState` and `history.replaceState`
 *  fire `navigate` events too. Without the check, the layer's own
 *  `commitHistory` push was a navigate event the layer then intercepted,
 *  which swapped, which pushed — a loop Chromium ends with "Throttling
 *  navigation to prevent the browser from hanging". Worse, every
 *  framework router changes routes by calling `pushState`, so an app's
 *  in-router navigation would have been taken over and answered with a
 *  full document swap.
 *
 *  A link click is a same-document event by the time it gets here too,
 *  for a different reason: the click listener prevented the browser's
 *  cross-document navigation, and what remains is the layer's own push. */
const readDestinationUrl = (event: Event) => {
	const destination: unknown = Reflect.get(event, 'destination');
	if (typeof destination !== 'object' || destination === null)
		return undefined;
	if (Reflect.get(destination, 'sameDocument') !== false) return undefined;
	const href: unknown = Reflect.get(destination, 'url');
	if (typeof href !== 'string') return undefined;
	try {
		return new URL(href);
	} catch {
		return undefined;
	}
};

/** What the layer can act on, or `undefined` for a navigation it must
 *  leave alone. Each rejection is its own kind of navigation:
 *
 *  - `canIntercept` false: cross-origin, or a document the API will not
 *    hand over. Not ours to take.
 *  - `hashChange`: same document already.
 *  - `downloadRequest`: a file, not a page.
 *  - `formData` present: a POST. The swap fetches the target with GET, so
 *    taking this over would turn a submission into a read of the action
 *    URL — a different request, usually a 404 or a form the user already
 *    filled in. Form actions (`useFormAction`, `absAction`) are how a
 *    POST stays on the page.
 *  - `traverse` / `reload`: back, forward and reloads belong to the
 *    popstate listener and the browser respectively. */
const readNavigateIntent = (event: Event) => {
	if (Reflect.get(event, 'canIntercept') !== true) return undefined;
	if (Reflect.get(event, 'hashChange') === true) return undefined;
	const download: unknown = Reflect.get(event, 'downloadRequest');
	if (typeof download === 'string') return undefined;
	const formData: unknown = Reflect.get(event, 'formData');
	if (formData !== null && formData !== undefined) return undefined;
	const navigationType: unknown = Reflect.get(event, 'navigationType');
	if (navigationType !== 'push' && navigationType !== 'replace')
		return undefined;
	const intercept: unknown = Reflect.get(event, 'intercept');
	const url = readDestinationUrl(event);
	if (typeof intercept !== 'function' || !url) return undefined;
	const source: unknown = Reflect.get(event, 'sourceElement');
	const intent: NavigateIntent = {
		replace: navigationType === 'replace',
		source: source instanceof Element ? source : undefined,
		url,
		intercept: (options: unknown) =>
			Reflect.apply(intercept, event, [options])
	};

	return intent;
};

/** Whether the element that started this navigation opted out of the
 *  layer — the submit button of a form carrying
 *  `data-absolute-navigation="off"`, say, since `sourceElement` for a form
 *  submission is the button rather than the form. */
const sourceOptedOut = (source: Element | undefined) =>
	source !== undefined && source.closest(OPT_OUT_SELECTOR) !== null;

const listenForNavigations = (nav: Runtime, api: NavigationLike) => {
	const onNavigate = (event: Event) => {
		if (nav.handingOff) return;
		const intent = readNavigateIntent(event);
		if (!intent) return;
		const { intercept, replace, source, url } = intent;
		if (wasDeclined(nav, url) || sourceOptedOut(source)) return;
		if (isSamePageFragment(url)) return;
		if (nav.options.shouldIntercept?.(url) === false) return;
		if (!canTearDown()) return;
		/* Before `intercept()`, which commits the destination entry
		 * immediately: after it, the entry being left is no longer the
		 * current one and its scroll position has nowhere to go. */
		rememberScroll(nav);
		intercept({
			/* The swap resets focus and handles scroll itself, including
			 * restoring a saved position on a traversal. Left to the API
			 * both would happen twice, in the wrong order. */
			focusReset: 'manual',
			scroll: 'manual',
			handler: async () => {
				await performNavigation(nav, {
					managedHistory: true,
					replace,
					type: 'navigate',
					url
				});
			}
		});
	};
	api.addEventListener('navigate', onNavigate);
	nav.teardown.push(() => api.removeEventListener('navigate', onNavigate));
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Turn the layer off: listeners removed, history methods restored. */
export const disableNavigation = () => {
	const installed = readPublicRuntime();
	if (installed && typeof installed.disable === 'function') {
		Reflect.apply(installed.disable, undefined, []);
	}
};

const teardownRuntime = (nav: Runtime) => {
	nav.controller?.abort();
	for (const cleanup of nav.teardown.splice(0)) cleanup();
	nav.restoreHistory?.();
	Reflect.deleteProperty(globalThis, RUNTIME_KEY);
	if (runtime === nav) runtime = undefined;
};

const navigateWith =
	(nav: Runtime) =>
	(href: string, options: NavigateDocumentOptions = {}) => {
		const url = new URL(href, window.location.href);
		if (url.origin !== window.location.origin) {
			window.location.assign(url.href);

			return Promise.resolve<DocumentNavigationOutcome>('reloaded');
		}

		return performNavigation(nav, {
			replace: options.replace === true,
			type: 'navigate',
			url
		});
	};

/* The current page again, from the server: same address, same history
 * entry, same scroll position. */
const refreshWith = (nav: Runtime) =>
	performNavigation(nav, {
		replace: true,
		scroll: { left: window.scrollX, top: window.scrollY },
		type: 'refresh',
		url: new URL(window.location.href)
	});

/**
 * Install cross-framework document navigation for this tab. Idempotent:
 * every page can call it (each framework bundle carries its own copy of
 * this module; the first call wins and its options apply).
 */
export const enableNavigation = (options: EnableNavigationOptions = {}) => {
	if (typeof window === 'undefined' || readPublicRuntime()) return;
	const navigationApi = readNavigationApi();
	const nav: Runtime = {
		controller: undefined,
		declined: undefined,
		documentId: createId(),
		entryOwners: new Map(),
		evaluatedModules: new Set(),
		handingOff: false,
		moduleRun: 0,
		navigating: false,
		navigationApi,
		nonce: readPageNonce(),
		options,
		restoreHistory: undefined,
		scroll: new Map(),
		scrollFrame: 0,
		teardown: [],
		token: 0
	};
	runtime = nav;
	if (navigationApi) trackEntries(nav, navigationApi);
	else patchHistory(nav);
	rememberDocumentModules(nav);
	trackScroll(nav);
	listenForClicks(nav);
	listenForTraversals(nav);
	// Forms and `location.assign()`, where the browser has the event for
	// them. Installed after the click listener, which still owns clicks.
	if (navigationApi) listenForNavigations(nav, navigationApi);
	const publicRuntime: PublicRuntime = {
		navigate: navigateWith(nav),
		disable: () => teardownRuntime(nav),
		refresh: () => refreshWith(nav)
	};
	Reflect.set(globalThis, RUNTIME_KEY, publicRuntime);
	// A static page takes part by making this call like any other page;
	// on a framework page the index has already registered the real hook.
	markPageWithoutTeardown();
};

const OUTCOMES = new Set<unknown>([
	'cancelled',
	'reloaded',
	'superseded',
	'swapped'
]);

const isOutcome = (value: unknown): value is DocumentNavigationOutcome =>
	OUTCOMES.has(value);

/** Whether `enableNavigation()` is active in this tab. */
export const isNavigationEnabled = () =>
	typeof window !== 'undefined' && readPublicRuntime() !== undefined;

/**
 * Navigate to `href` through the layer: a soft swap when it is enabled
 * and the page can be torn down, a normal page load otherwise.
 */
export const navigateDocument = async (
	href: string,
	options: NavigateDocumentOptions = {}
) => {
	const installed = readPublicRuntime();
	const navigate = installed?.navigate;
	if (typeof navigate === 'function') {
		const result: unknown = await Reflect.apply(navigate, undefined, [
			href,
			options
		]);
		if (isOutcome(result)) return result;
	}
	if (options.replace) window.location.replace(href);
	else window.location.assign(href);

	return outcome('reloaded');
};
