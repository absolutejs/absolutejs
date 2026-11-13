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
import { consumePrefetch } from './prefetch';

/* Shared by every bundle copy of this module (each framework's client pass
 * bundles its own), and read by the Svelte `<Link>` to decide whether a
 * URL no `<Router>` matches should be handed to the browser. */
const RUNTIME_KEY = Symbol.for('absolutejs.navigation');
const STATE_KEY = '__absoluteNavigation';
const OPT_OUT_SELECTOR = '[data-absolute-navigation="off"]';
const MODULE_RUN_PARAM = 'absolute-nav';
const ANNOUNCER_ID = 'absolute-navigation-announcer';
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
	replace: boolean;
	/** Scroll position saved for the destination entry (traversals). */
	scroll?: ScrollPosition;
	type: DocumentNavigationType;
	url: URL;
};

type Runtime = {
	controller: AbortController | undefined;
	documentId: string;
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

const loadDocument = async (nav: Runtime, url: URL, signal: AbortSignal) => {
	const response = await fetchDocument(url, signal);
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

const disposeCurrentPage = async () => {
	const dispose: unknown = Reflect.get(window, DISPOSE_GLOBAL);
	Reflect.set(window, DISPOSE_GLOBAL, undefined);
	Reflect.set(window, READY_GLOBAL, undefined);
	if (typeof dispose === 'function') await Reflect.apply(dispose, window, []);
};

const canTearDown = () =>
	typeof Reflect.get(window, DISPOSE_GLOBAL) === 'function';

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
	islandState: IslandStateRef
) => {
	if (!pending.placeholder.isConnected) return;
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
const runScripts = (nav: Runtime, scripts: PendingScript[]) => {
	const islandState: IslandStateRef = {
		live: islandStateOf(Reflect.get(globalThis, ISLAND_STATE_GLOBAL))
	};

	return scripts.reduce<Promise<void>>(
		(previous, pending) =>
			previous.then(() => runScript(nav, pending, islandState)),
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

const ensureAnnouncer = () => {
	const existing = document.getElementById(ANNOUNCER_ID);
	if (existing) return existing;
	const region = document.createElement('div');
	region.id = ANNOUNCER_ID;
	region.setAttribute('aria-live', 'assertive');
	region.setAttribute('aria-atomic', 'true');
	region.setAttribute('role', 'status');
	// CSSOM, not a style attribute: a strict `style-src-attr` can't block it.
	Object.assign(region.style, {
		border: '0',
		clip: 'rect(0 0 0 0)',
		height: '1px',
		margin: '-1px',
		overflow: 'hidden',
		padding: '0',
		position: 'absolute',
		whiteSpace: 'nowrap',
		width: '1px'
	});
	document.body.append(region);

	return region;
};

const announcePage = () => {
	const heading = document.querySelector('h1')?.textContent?.trim();
	const text = document.title || heading || window.location.pathname;
	ensureAnnouncer().textContent = text;
};

const resetFocus = () => {
	const autofocus = document.querySelector<HTMLElement>('[autofocus]');
	if (autofocus) {
		autofocus.focus();

		return;
	}
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
};

const dispatch = (
	name: string,
	detail: DocumentNavigationEventDetail,
	cancelable: boolean
) => window.dispatchEvent(new CustomEvent(name, { cancelable, detail }));

/* ------------------------------------------------------------------ */
/* The navigation                                                      */
/* ------------------------------------------------------------------ */

const outcome = (value: DocumentNavigationOutcome) => value;

const reload = (request: NavigationRequest, committed: boolean) => {
	if (committed || request.type === 'traverse') window.location.reload();
	else if (request.replace) window.location.replace(request.url.href);
	else window.location.assign(request.url.href);

	return outcome('reloaded');
};

const commitHistory = (nav: Runtime, request: NavigationRequest, url: URL) => {
	nav.documentId = request.documentId ?? createId();
	if (request.type === 'traverse') {
		recordCurrentEntry(nav);

		return;
	}
	const key = currentEntryKey(nav);
	if (key !== undefined) {
		nav.scroll.set(key, { left: window.scrollX, top: window.scrollY });
	}
	const state = stampState(null, nav.documentId, createId());
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

const runSwap = async (nav: Runtime, swap: () => Promise<void>) => {
	const start: unknown = Reflect.get(document, 'startViewTransition');
	if (!shouldAnimate(nav) || typeof start !== 'function') {
		await swap();

		return;
	}
	const transition: unknown = Reflect.apply(start, document, [swap]);
	readPromise(transition, 'ready')?.catch(() => undefined);
	readPromise(transition, 'finished')?.catch(() => undefined);
	await readPromise(transition, 'updateCallbackDone');
};

const swapDocument = async (
	nav: Runtime,
	request: NavigationRequest,
	loaded: LoadedDocument,
	isStale: () => boolean
) => {
	const scripts = extractScripts(loaded);
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
	const swap = async () => {
		await disposeCurrentPage();
		clearPageGlobals();
		syncAttributes(
			document.documentElement,
			loaded.document.documentElement
		);
		swapHead(nav, loaded, headNodes, preloaded);
		swapBody(nav, loaded);
		restoreMedia(media);
		applyScroll(request, loaded.url);
	};
	await runSwap(nav, swap);
	resetFocus();
	await runScripts(nav, scripts);
	await waitForPageReady(loadsModules(scripts));
	reapplyScroll(request, loaded.url);
	announcePage();

	return true;
};

const isCurrent = (nav: Runtime, token: number) => nav.token === token;

const performNavigation = async (nav: Runtime, request: NavigationRequest) => {
	nav.token += 1;
	const { token } = nav;
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
	if (!canTearDown()) return reload(request, false);

	const committedBefore = nav.documentId;
	try {
		const loaded = await loadDocument(nav, request.url, controller.signal);
		if (!isCurrent(nav, token)) return outcome('superseded');
		if (!loaded) return reload(request, false);
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

		return reload(request, nav.documentId !== committedBefore);
	} finally {
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

/* Bubble phase on window: runs after every framework router's handler, so
 * a click a router handled (`preventDefault`) never reaches this. */
const listenForClicks = (nav: Runtime) => {
	const onClick = (event: MouseEvent) => {
		if (!isPlainClick(event)) return;
		const anchor = findAnchor(event);
		const url = anchor ? interceptableUrl(nav, anchor) : undefined;
		if (!url || !canTearDown()) return;
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
		documentId: createId(),
		entryOwners: new Map(),
		evaluatedModules: new Set(),
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
	const publicRuntime: PublicRuntime = {
		navigate: navigateWith(nav),
		disable: () => teardownRuntime(nav)
	};
	Reflect.set(globalThis, RUNTIME_KEY, publicRuntime);
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
