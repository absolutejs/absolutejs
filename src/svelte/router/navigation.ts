import { onDestroy, tick } from 'svelte';
import type {
	GotoOptions,
	NavigationOutcome,
	NavigationType,
	RouteGuard,
	RouterMode,
	ScrollPosition
} from '../../../types/svelteRouter';
import { type GuardDecision, type GuardEntry, runGuardChain } from './guards';
import { buildHashHref } from './hashMode';
import { hasPendingLazyLoads, whenLazySettled } from './lazy';
import { page, setPage } from './page.svelte';
import {
	adoptHistoryEntry,
	currentCommittedHref,
	currentHistoryEntry,
	readHistoryMeta,
	readUserState,
	rememberScroll,
	savedScrollFor,
	scrollToHash,
	scrollToPosition,
	writeHistoryEntry
} from './scroll';
import { withViewTransition } from './viewTransitions';

/* The browser navigation path shared by `goto()`, `<Link>` and the
 * outermost `<Router>`'s popstate listener:
 *
 *   guards  →  history write  →  page swap (in a View Transition)  →  scroll
 *
 * Each navigation takes a token; a guard that resolves after a newer
 * navigation started is ignored ("superseded"). */

export type RouterNavigationHandle = {
	/** Guards that apply when navigating to `url`, outermost first. */
	guardsFor: (url: URL) => GuardEntry[];
	/** Whether one of this router's routes matches `url`. */
	matches: (url: URL) => boolean;
	/** Start loading the lazy route `url` would render, if any. */
	preload: (url: URL) => void;
};

type ScrollIntent =
	| { kind: 'none' }
	| { kind: 'top' }
	| { kind: 'hash'; hash: string }
	| { kind: 'restore'; position: ScrollPosition };

const ALLOW: GuardDecision = { kind: 'allow' };
const MAX_REDIRECTS = 10;
const routers = new Set<RouterNavigationHandle>();
const globalGuards = new Set<RouteGuard>();
let activeMode: RouterMode = 'history';
let navigationToken = 0;
let ignoredPopStates = 0;

/** @internal Router.svelte: make a router's guards and lazy routes
 *  visible to navigation. Returns the deregistration. */
export const registerRouter = (handle: RouterNavigationHandle) => {
	routers.add(handle);

	return () => {
		routers.delete(handle);
	};
};

/** @internal Router.svelte: which URL strategy goto() writes. */
export const setRouterMode = (mode: RouterMode) => {
	activeMode = mode;
};

const unregisterGuard = (guard: RouteGuard) => () => {
	globalGuards.delete(guard);
};

/**
 * Run `guard` before every client-side navigation (`<Link>`, `goto()`,
 * back/forward). Return `false` to cancel, a URL (or `redirect(...)`) to
 * redirect, nothing to allow. Called during component initialisation it
 * is removed when the component is destroyed; otherwise call the returned
 * function to remove it.
 *
 * Browser-only: it doesn't run during the server render. Put checks the
 * server must enforce (auth, a 302 on the first request) on
 * `<Router guard>` or `<Route guard>` instead.
 */
export const beforeNavigate = (guard: RouteGuard) => {
	const remove = unregisterGuard(guard);
	if (typeof window === 'undefined') return remove;
	globalGuards.add(guard);
	try {
		onDestroy(remove);
	} catch {
		// Called outside component initialisation: the caller owns removal.
	}

	return remove;
};

const collectGuards = (url: URL) => {
	const entries: GuardEntry[] = Array.from(globalGuards, (guard) => ({
		guard,
		params: {}
	}));
	for (const router of routers) entries.push(...router.guardsFor(url));

	return entries;
};

/** Start loading the lazy route component `href` would render, through
 *  every mounted router. Used by `<Link>` prefetching. */
export const preloadRoute = (href: string) => {
	if (typeof window === 'undefined') return;
	const url = new URL(href, window.location.href);
	if (url.origin !== window.location.origin) return;
	for (const router of routers) router.preload(url);
};

/* Set by `enableNavigation()` (src/client/navigation.ts) on globalThis, so
 * the check works whichever bundle copy installed it. */
const DOCUMENT_NAVIGATION_KEY = Symbol.for('absolutejs.navigation');

/**
 * @internal Link.svelte: whether a click on `href` belongs to cross-framework
 * document navigation rather than this router. True only when
 * `enableNavigation()` is active, the router uses history mode, and no
 * mounted `<Router>` has a route for the URL: the link points at another
 * page (possibly another framework's), so `<Link>` leaves the click to the
 * browser and the navigation layer swaps that page in.
 */
export const belongsToDocumentNavigation = (href: string) => {
	if (typeof window === 'undefined' || activeMode === 'hash') return false;
	if (Reflect.get(globalThis, DOCUMENT_NAVIGATION_KEY) === undefined) {
		return false;
	}
	const url = new URL(href, window.location.href);
	if (url.origin !== window.location.origin) return false;

	return !Array.from(routers).some((router) => router.matches(url));
};

const resolveAbsoluteUrl = (target: string) => {
	if (typeof window === 'undefined') {
		// Programmatic goto on the server is rare but we tolerate it as a
		// way for tests to drive the router without a real DOM.
		return new URL(target, 'http://localhost/');
	}

	return new URL(target, window.location.href);
};

const buildHref = (target: URL) =>
	activeMode === 'hash'
		? `${window.location.pathname}${window.location.search}${buildHashHref(target.pathname + target.search)}`
		: `${target.pathname}${target.search}${target.hash}`;

/** Same document, same path and query — only the fragment differs. No
 *  route changes, so guards don't run (same as shallow routing). */
const isFragmentOnlyChange = (from: URL, target: URL) =>
	activeMode === 'history' &&
	from.origin === target.origin &&
	from.pathname === target.pathname &&
	from.search === target.search;

const applyScrollIntent = (intent: ScrollIntent) => {
	if (intent.kind === 'none') return;
	if (intent.kind === 'restore') {
		scrollToPosition(intent.position);

		return;
	}
	if (intent.kind === 'hash' && scrollToHash(intent.hash)) return;
	window.scrollTo({ left: 0, top: 0 });
};

const nextFrame = () =>
	new Promise<void>((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});

/** A lazy route that was still loading when the scroll was applied may
 *  have grown the page since; apply the intent once more when it lands,
 *  unless the user scrolled in the meantime. */
const reapplyAfterLazyLoads = async (intent: ScrollIntent) => {
	if (intent.kind === 'none' || intent.kind === 'top') return;
	if (!hasPendingLazyLoads()) return;
	const appliedY = window.scrollY;
	await whenLazySettled();
	await tick();
	await nextFrame();
	if (window.scrollY !== appliedY) return;
	applyScrollIntent(intent);
};

const blurActiveElement = (options: GotoOptions) => {
	if (options.keepFocus) return;
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
};

const pushIntent = (url: URL, options: GotoOptions): ScrollIntent => {
	if (options.noScroll) return { kind: 'none' };
	if (activeMode === 'history' && url.hash !== '') {
		return { hash: url.hash, kind: 'hash' };
	}

	return { kind: 'top' };
};

const commitNavigation = async (url: URL, options: GotoOptions) => {
	const intent = pushIntent(url, options);
	const mutate = async () => {
		writeHistoryEntry(
			buildHref(url),
			options.state ?? null,
			options.replaceState ? 'replace' : 'push'
		);
		setPage({ params: {}, state: options.state ?? null, url });
		blurActiveElement(options);
		await tick();
		applyScrollIntent(intent);
	};

	await withViewTransition(mutate);
	await reapplyAfterLazyLoads(intent);
};

/** Run every applicable guard for a navigation from the current page to
 *  `url`, as navigation number `token`. */
const decide = (url: URL, type: NavigationType, token: number) => {
	const from = new URL(page.url.href);
	if (isFragmentOnlyChange(from, url)) return Promise.resolve(ALLOW);

	return runGuardChain(
		collectGuards(url),
		{ from, request: undefined, to: url, type },
		() => token !== navigationToken
	);
};

const startNavigation = () => {
	navigationToken += 1;

	return navigationToken;
};

const assertRedirectDepth = (depth: number, location: string) => {
	if (depth < MAX_REDIRECTS) return;
	throw new Error(
		`Svelte router: more than ${MAX_REDIRECTS} guard redirects in a row (last to ${location}).`
	);
};

const navigateWithin = async (
	target: string,
	options: GotoOptions,
	type: NavigationType,
	depth: number
): Promise<NavigationOutcome> => {
	const url = resolveAbsoluteUrl(target);

	if (typeof window === 'undefined') {
		setPage({ params: {}, state: options.state ?? null, url });

		return 'committed';
	}

	if (url.origin !== window.location.origin) {
		// External URLs go through the browser — we don't try to SPA them.
		window.location.href = url.href;

		return 'external';
	}

	const decision = await decide(url, type, startNavigation());
	if (decision.kind === 'stale') return 'superseded';
	if (decision.kind === 'cancel') return 'cancelled';
	if (decision.kind === 'redirect') {
		assertRedirectDepth(depth, decision.location);
		await navigateWithin(
			decision.location,
			{ replaceState: decision.replace || options.replaceState },
			type,
			depth + 1
		);

		return 'redirected';
	}

	// `goto` performs no network fetch of its own: the swap is a client-side
	// route match against the registered <Route>s. What `<Link prefetch>`
	// buys the click is already in place by now — the target's HTML in the
	// HTTP cache, its modules preloaded and, for a lazy route, its
	// component chunk loaded.
	await commitNavigation(url, options);

	return 'committed';
};

/** @internal `goto()` and `<Link>`: guarded client-side navigation. */
export const navigate = (
	target: string,
	options: GotoOptions,
	type: NavigationType
) => navigateWithin(target, options, type, 0);

/** Put the URL bar back after a cancelled back/forward navigation: undo
 *  the traversal with `history.go`, or — when the entry being left is
 *  unknown — push the previous URL again. */
const undoTraversal = (state: unknown, previousHref: string | undefined) => {
	const landed = readHistoryMeta(state);
	const left = currentHistoryEntry();
	const delta = landed && left ? landed.index - left.index : 0;
	if (delta !== 0) {
		ignoredPopStates += 1;
		window.history.go(-delta);

		return;
	}
	if (previousHref === undefined) return;
	window.history.pushState(window.history.state, '', previousHref);
};

const restoreIntent = (state: unknown, url: URL): ScrollIntent => {
	const meta = adoptHistoryEntry(state);
	const saved = savedScrollFor(meta);
	if (saved) return { kind: 'restore', position: saved };
	if (activeMode === 'history' && url.hash !== '') {
		return { hash: url.hash, kind: 'hash' };
	}

	return { kind: 'top' };
};

const commitTraversal = async (state: unknown, url: URL) => {
	const fragmentOnly = isFragmentOnlyChange(page.url, url);
	const intent = restoreIntent(state, url);
	const mutate = async () => {
		setPage({ params: {}, state: readUserState(state) ?? null, url });
		await tick();
		applyScrollIntent(intent);
	};

	if (fragmentOnly) await mutate();
	else await withViewTransition(mutate);
	await reapplyAfterLazyLoads(intent);
};

/** @internal Router.svelte (hash mode): guards for the first client
 *  render, which the server could not run because it never sees the
 *  hash. A redirect replaces the entry; a cancel is ignored (there is no
 *  previous page to stay on). */
export const enterInitialRoute = async (url: URL) => {
	const token = startNavigation();
	const decision = await runGuardChain(
		Array.from(routers, (router) => router.guardsFor(url)).flat(),
		{ from: null, request: undefined, to: url, type: 'enter' },
		() => token !== navigationToken
	);
	if (decision.kind !== 'redirect') return;
	await navigateWithin(decision.location, { replaceState: true }, 'enter', 1);
};

/**
 * @internal Router.svelte: a `popstate` landed. `url` is the routable URL
 * of the entry it landed on (hash mode already resolved). Runs the guards;
 * a cancel puts the previous URL back, a redirect replaces the entry.
 */
export const handleTraversal = async (state: unknown, url: URL) => {
	if (ignoredPopStates > 0) {
		ignoredPopStates -= 1;

		return;
	}

	// The browser already moved; under manual scroll restoration the
	// window still shows the entry being left, so this is its position.
	rememberScroll();
	const previousHref = currentCommittedHref();
	const decision = await decide(url, 'popstate', startNavigation());
	if (decision.kind === 'stale') return;
	if (decision.kind === 'cancel') {
		undoTraversal(state, previousHref);

		return;
	}
	if (decision.kind === 'redirect') {
		adoptHistoryEntry(state);
		await navigateWithin(
			decision.location,
			{ replaceState: true },
			'popstate',
			1
		);

		return;
	}

	await commitTraversal(state, url);
};

/** @internal Router.svelte: restore the position saved in the entry the
 *  page loaded on (reload, or back/forward into this document). */
export const restoreInitialScroll = async (position: ScrollPosition) => {
	await tick();
	await whenLazySettled();
	await nextFrame();
	scrollToPosition(position);
};
