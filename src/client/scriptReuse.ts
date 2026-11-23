/* Which of an incoming page's scripts the live document is already
 * running.
 *
 * A third-party script is the same script on every page that carries it:
 * an analytics tag, a consent manager, a chat widget. The navigation layer
 * recreates every executable script of the page being swapped in, so
 * without this such a tag runs again on each navigation — measured in a
 * browser on two pages that both carry one tag, its counter read 1, then
 * 2, then 3 across two soft navigations. A real analytics tag
 * double-counts; a widget re-initialises.
 *
 * Deduplication is keyed on the identity marker a `<Script>` renders, NOT
 * on `src` for every script. A page's own hydration index has the same
 * `src` across a navigation and MUST run again — that is the mechanism by
 * which the incoming page mounts at all.
 *
 * The live element is MOVED into the new document rather than dropped, so
 * the page still carries the tag that is running. Moving a script element
 * that has already executed does not execute it again: the browser keeps
 * an "already started" flag on the element itself, which is why this
 * cannot be done by recreating the node from the incoming markup. */

import { SCRIPT_MARKER } from './scriptMarker';

/** Puts back the marked scripts the incoming page does NOT carry, so the
 *  document keeps recording what is running, and drops them from `live` so
 *  nothing claims them later.
 *
 *  Called BEFORE the incoming page's scripts run, and the order is not a
 *  detail: a `lazyOnload` script renders an inline bootstrap that checks
 *  the document for its tag, and that check happens on a timer. Appending
 *  afterwards lost the race — `runScripts` awaits each module's load
 *  event, so the bootstrap's `setTimeout(…, 0)` fired first, found no tag
 *  and added a SECOND one. Measured: two identical tags in the head and
 *  the counter at 2.
 *
 *  Two cases need this at all. A `lazyOnload` script is never in a page's
 *  markup, so nothing claims it and the head swap throws the tag away. And
 *  a visit from a page that carries a script to one that does not and back
 *  again re-runs it on arrival — the same double-count, two navigations
 *  later. Keeping the tag is also the truth of it: the script has already
 *  run and its effects are in the page, so removing the element unloads
 *  nothing, it only loses the record. */
export const keepRunningScripts = (
	live: Map<string, HTMLScriptElement>,
	incoming: Iterable<Element>
) => {
	const carried = new Set(
		[...incoming].flatMap((source) => {
			const identity = source.getAttribute(SCRIPT_MARKER);

			return identity === null || identity === '' ? [] : [identity];
		})
	);
	for (const [identity, script] of [...live.entries()]) {
		if (carried.has(identity)) continue;
		document.head.append(script);
		live.delete(identity);
	}
};

/** The live document's marked scripts, by identity. Captured BEFORE the
 *  head is swapped, which detaches the nodes. First one wins: a page that
 *  somehow renders the same identity twice has one script, not two. */
export const liveScriptsByIdentity = (root: Document | Element) => {
	const live = new Map<string, HTMLScriptElement>();
	for (const script of Array.from(
		root.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`)
	)) {
		const identity = script.getAttribute(SCRIPT_MARKER);
		if (identity !== null && identity !== '' && !live.has(identity))
			live.set(identity, script);
	}

	return live;
};

/** The already-running element to put in this script's place, or
 *  `undefined` when it has to run. Consumes the entry, so two tags with
 *  one identity cannot both claim the same element. */
export const reusableScript = (
	live: Map<string, HTMLScriptElement>,
	source: Element
) => {
	const identity = source.getAttribute(SCRIPT_MARKER);
	if (identity === null || identity === '') return undefined;
	const running = live.get(identity);
	if (running === undefined) return undefined;
	live.delete(identity);

	return running;
};
