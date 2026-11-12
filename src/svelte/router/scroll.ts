import type {
	RouterHistoryMeta,
	ScrollPosition
} from '../../../types/svelteRouter';

/* History bookkeeping + scroll restoration for the Svelte router.
 *
 * Every history entry the router writes carries a small record next to the
 * user's own state: `{ __absoluteRouter: { key, index, scroll? }, user }`.
 *  - `key` identifies the entry, so the scroll position saved when the
 *    user left it can be restored when they come back.
 *  - `index` is the entry's position in the session history, so a guard
 *    that cancels a back/forward navigation can undo it with `history.go`.
 *  - `scroll` is written into the entry itself when it is left (and on
 *    `pagehide`), so the position survives a reload or a cross-document
 *    round trip, not only in-memory navigations.
 * `page.state` and `event.state` consumers see the user's state unchanged
 * through `readUserState`. Browser-only: nothing here runs during SSR. */

const META_FIELD = '__absoluteRouter';
const KEY_RADIX = 36;
const KEY_RANDOM_START = 2;
const KEY_RANDOM_END = 10;
const SCROLL_SETTLE_MS = 150;
const SCROLL_STORAGE_PREFIX = 'absolute-router-scroll:';

type WrappedHistoryState = {
	[META_FIELD]: RouterHistoryMeta;
	user: unknown;
};

const positions = new Map<string, ScrollPosition>();
let current: RouterHistoryMeta | undefined;
let committedHref: string | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isScrollPosition = (value: unknown): value is ScrollPosition =>
	isRecord(value) &&
	typeof value.x === 'number' &&
	typeof value.y === 'number';

const createKey = () =>
	`${Date.now().toString(KEY_RADIX)}${Math.random()
		.toString(KEY_RADIX)
		.slice(KEY_RANDOM_START, KEY_RANDOM_END)}`;

export const readHistoryMeta = (state: unknown) => {
	if (!isRecord(state)) return undefined;
	const meta = state[META_FIELD];
	if (!isRecord(meta)) return undefined;
	if (typeof meta.key !== 'string' || typeof meta.index !== 'number') {
		return undefined;
	}
	const parsed: RouterHistoryMeta = { index: meta.index, key: meta.key };
	if (isScrollPosition(meta.scroll)) parsed.scroll = meta.scroll;

	return parsed;
};

/** The state the application stored (via `goto({ state })`, `pushState`,
 *  …), without the router's bookkeeping. */
export const readUserState = (state: unknown) => {
	if (readHistoryMeta(state) === undefined || !isRecord(state)) return state;

	return state.user;
};

const wrapState = (user: unknown, meta: RouterHistoryMeta) => {
	const wrapped: WrappedHistoryState = { [META_FIELD]: meta, user };

	return wrapped;
};

const readScroll = () => {
	const position: ScrollPosition = {
		x: window.scrollX,
		y: window.scrollY
	};

	return position;
};

/** Adopt the entry a `popstate` landed on as the current one. Entries the
 *  router didn't write (a plain `<a href="#x">` click, say) get stamped. */
export const adoptHistoryEntry = (state: unknown) => {
	const existing = readHistoryMeta(state);
	committedHref = window.location.href;
	if (existing) {
		current = existing;

		return existing;
	}
	const meta: RouterHistoryMeta = {
		index: (current?.index ?? 0) + 1,
		key: createKey()
	};
	window.history.replaceState(wrapState(state, meta), '');
	current = meta;

	return meta;
};

/** The full URL (hash included) of the entry the router currently shows. */
export const currentCommittedHref = () => committedHref;

/** The entry the router currently shows. */
export const currentHistoryEntry = () => current;

/** Record the live scroll position for the current entry, in memory and in
 *  the entry's `history.state`, so it survives a reload. */
export const persistScroll = () => {
	if (!current || typeof window === 'undefined') return;
	const scroll = readScroll();
	positions.set(current.key, scroll);
	if (readHistoryMeta(window.history.state)?.key !== current.key) return;
	current = { ...current, scroll };
	window.history.replaceState(
		wrapState(readUserState(window.history.state), current),
		''
	);
};

/** Record the live scroll position for the current entry (in memory). */
export const rememberScroll = () => {
	if (!current || typeof window === 'undefined') return;
	positions.set(current.key, readScroll());
};

/** Where the user was when they last left `meta`'s entry, if known. */
export const savedScrollFor = (meta: RouterHistoryMeta) =>
	positions.get(meta.key) ?? meta.scroll;

const storageKey = (key: string) => `${SCROLL_STORAGE_PREFIX}${key}`;

/** The position `pagehide` stored for `key` in sessionStorage — the
 *  reliable record for a reload, since some engines drop a
 *  `history.replaceState` made while the page unloads. Read once. */
const readStoredScroll = (key: string) => {
	try {
		const raw = window.sessionStorage.getItem(storageKey(key));
		if (raw === null) return undefined;
		window.sessionStorage.removeItem(storageKey(key));
		const parsed: unknown = JSON.parse(raw);

		return isScrollPosition(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

const storeScroll = () => {
	if (!current) return;
	try {
		window.sessionStorage.setItem(
			storageKey(current.key),
			JSON.stringify(readScroll())
		);
	} catch {
		// Storage disabled or full: history.state is the only record.
	}
};

/** Make sure the entry the page loaded on carries router bookkeeping, and
 *  adopt it as the current one. Returns its meta. */
export const stampInitialEntry = () => {
	const existing = readHistoryMeta(window.history.state);
	committedHref = window.location.href;
	if (existing) {
		const scroll = readStoredScroll(existing.key) ?? existing.scroll;
		current = scroll ? { ...existing, scroll } : existing;
		if (scroll) positions.set(existing.key, scroll);

		return current;
	}
	const meta: RouterHistoryMeta = { index: 0, key: createKey() };
	window.history.replaceState(wrapState(window.history.state, meta), '');
	current = meta;

	return meta;
};

/** Write a new entry (`push`) or replace the current one, saving the
 *  scroll position of the entry being left first. */
export const writeHistoryEntry = (
	href: string,
	user: unknown,
	mode: 'push' | 'replace'
) => {
	if (mode === 'push') persistScroll();
	const index = current?.index ?? 0;
	const meta: RouterHistoryMeta = {
		index: mode === 'push' ? index + 1 : index,
		key: createKey()
	};
	if (mode === 'push') {
		window.history.pushState(wrapState(user, meta), '', href);
	} else {
		window.history.replaceState(wrapState(user, meta), '', href);
	}
	current = meta;
	committedHref = window.location.href;

	return meta;
};

const decodeFragment = (raw: string) => {
	try {
		return decodeURIComponent(raw);
	} catch {
		// Malformed escape: look the raw fragment up instead.
		return raw;
	}
};

const findHashTarget = (hash: string) => {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	if (raw === '') return undefined;
	const fragment = decodeFragment(raw);

	return (
		document.getElementById(fragment) ??
		document.getElementsByName(fragment).item(0) ??
		undefined
	);
};

/** Take over scroll restoration from the browser while a router is
 *  mounted: `history.scrollRestoration = 'manual'`, track the scroll
 *  position of the current entry, and persist it on `pagehide`. Returns
 *  the cleanup that hands control back. */
export const activateScrollRestoration = () => {
	const { history } = window;
	const previousMode = history.scrollRestoration;
	history.scrollRestoration = 'manual';

	// In memory on every frame; into `history.state` once scrolling settles
	// (a reload only sees what is in the entry, and `pagehide` is too late
	// for some engines to accept a `replaceState`).
	let frame = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;
	const onScroll = () => {
		clearTimeout(settleTimer);
		settleTimer = setTimeout(persistScroll, SCROLL_SETTLE_MS);
		if (frame !== 0) return;
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			rememberScroll();
		});
	};
	const onPageHide = () => {
		persistScroll();
		storeScroll();
	};

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('pagehide', onPageHide);

	return () => {
		if (frame !== 0) window.cancelAnimationFrame(frame);
		clearTimeout(settleTimer);
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('pagehide', onPageHide);
		history.scrollRestoration = previousMode;
	};
};

/** Scroll the `#hash` target into view. Returns whether one was found —
 *  `#` and `#top` scroll to the top, as browsers do. */
export const scrollToHash = (hash: string) => {
	if (hash === '#' || hash.toLowerCase() === '#top') {
		window.scrollTo({ left: 0, top: 0 });

		return true;
	}
	const target = findHashTarget(hash);
	if (!target) return false;
	target.scrollIntoView();

	return true;
};

export const scrollToPosition = (position: ScrollPosition) => {
	window.scrollTo({ left: position.x, top: position.y });
};
