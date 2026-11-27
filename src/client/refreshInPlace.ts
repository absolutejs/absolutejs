/* A page given new data without being taken down.
 *
 * `invalidate()` used to mean "fetch this page's HTML again and put it
 * where this one is". That is always right and always costs the same
 * thing: the page is unmounted and mounted, so whatever its components
 * were holding — an open menu, half-typed text, a form's "saved" — is
 * gone. For a page whose framework can simply be handed new props, none
 * of that is necessary.
 *
 * Every page handler already answers a request for the page's DATA
 * (`application/vnd.absolute.route+json`): its props, as the route would
 * render them now. So a refresh can ask for that, and give the props to
 * the page that is already mounted. Its state survives because nothing
 * is torn down.
 *
 * This can only be done when it is certain the data is for the page on
 * screen. If the request was redirected, or the route now renders a
 * different page — a session that expired, say — the props belong
 * somewhere else, and applying them here would be wrong in a way that is
 * hard to see. Every such case is declined, and the caller falls back to
 * the full refresh, which handles all of them. */

import type {
	DocumentNavigationEventDetail,
	DocumentNavigationOutcome
} from '../../types/navigation';

const ROUTE_DATA_MEDIA_TYPE = 'application/vnd.absolute.route+json';
const UPDATE_GLOBAL = '__ABSOLUTE_PAGE_UPDATE__';

type RefreshState = { latest: number };

type PageUpdate = (props: Record<string, unknown>) => unknown;

const isPageUpdate = (value: unknown): value is PageUpdate =>
	typeof value === 'function';

/* One per tab, shared by every copy of this module a page's bundles
 * carry: the newest refresh is the one whose answer is applied. */
const STATE_KEY = Symbol.for('absolutejs.refreshInPlace');

const isRefreshState = (value: unknown): value is RefreshState =>
	typeof value === 'object' &&
	value !== null &&
	'latest' in value &&
	typeof value.latest === 'number';

const refreshState = () => {
	const existing: unknown = Reflect.get(globalThis, STATE_KEY);
	if (isRefreshState(existing)) return existing;
	const created: RefreshState = { latest: 0 };
	Reflect.set(globalThis, STATE_KEY, created);

	return created;
};

/** The mounted page's way of taking new props, when its framework's
 *  client entry registered one. */
export const readPageUpdate = () => {
	const update: unknown = Reflect.get(window, UPDATE_GLOBAL);

	return isPageUpdate(update) ? update : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const pathnameOf = (href: string) => {
	try {
		return new URL(href, window.location.href).pathname;
	} catch {
		return undefined;
	}
};

/* The page on screen loaded its client entry from a script, and the data
 * names the client entry of the page it is for. The same one means the
 * same page; anything else means the route answered for a different
 * page than the one mounted. */
const isForThisPage = (envelope: Record<string, unknown>) => {
	const { assets } = envelope;
	const index = isRecord(assets) ? assets.index : undefined;
	if (typeof index !== 'string') return false;
	const wanted = pathnameOf(index);

	return Array.from(document.scripts).some(
		(script) => script.src !== '' && pathnameOf(script.src) === wanted
	);
};

const readEnvelope = async (response: Response) => {
	const contentType = response.headers.get('content-type') ?? '';
	if (
		!response.ok ||
		response.redirected ||
		!contentType.includes(ROUTE_DATA_MEDIA_TYPE)
	) {
		await response.body?.cancel().catch(() => undefined);

		return undefined;
	}
	const envelope: unknown = await response.json().catch(() => undefined);
	if (!isRecord(envelope) || envelope.kind !== 'route') return undefined;

	return isRecord(envelope.props) && isForThisPage(envelope)
		? envelope
		: undefined;
};

const announce = (
	name: string,
	detail: DocumentNavigationEventDetail,
	cancelable: boolean
) => window.dispatchEvent(new CustomEvent(name, { cancelable, detail }));

const applyTitle = (envelope: Record<string, unknown>) => {
	const { head } = envelope;
	const title = isRecord(head) ? head.title : undefined;
	if (typeof title === 'string' && title !== '') document.title = title;
};

/** Refreshes the mounted page's data without unmounting it.
 *
 *  Resolves to `'updated'` when the page took the new props,
 *  `'cancelled'` when a listener refused the refresh, `'superseded'`
 *  when a newer refresh started first — and to `undefined` when it
 *  could not be done this way and the caller should refresh the whole
 *  page instead. It never throws. */
export const refreshInPlace = async (update: PageUpdate) => {
	const state = refreshState();
	state.latest += 1;
	const mine = state.latest;
	const detail: DocumentNavigationEventDetail = {
		type: 'refresh',
		url: window.location.href
	};
	const done = (outcome: DocumentNavigationOutcome) => outcome;
	if (!announce('absolute:before-navigate', detail, true))
		return done('cancelled');
	/* Not from the HTTP cache: the reason for asking is that the data
	 * changed since anything cached was fetched. */
	const response = await fetch(window.location.href, {
		cache: 'reload',
		credentials: 'same-origin',
		headers: { Accept: ROUTE_DATA_MEDIA_TYPE }
	}).catch(() => undefined);
	const envelope = response ? await readEnvelope(response) : undefined;
	if (mine !== state.latest) return done('superseded');
	if (!envelope || !isRecord(envelope.props)) return undefined;
	// The page was swapped out, or its hook withdrawn, while the data
	// was on its way.
	if (readPageUpdate() !== update) return undefined;
	if (update(envelope.props) === false) return undefined;
	applyTitle(envelope);
	announce('absolute:after-navigate', detail, false);

	return done('updated');
};
