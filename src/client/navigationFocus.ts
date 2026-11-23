/* Where focus goes after a soft navigation, and what is announced.
 *
 * A full page load does both of these for free: the browser moves focus to
 * the new document and the screen reader reads it. A soft navigation
 * replaces the page without either, so unless something does it
 * deliberately a keyboard user is left focused on a link that no longer
 * exists, and a screen reader user is told nothing happened at all.
 *
 * Kept apart from `navigation.ts` because it is the piece worth testing on
 * its own: what gets focused, and whether a page is announced twice. */

const ANNOUNCER_ID = 'absolute-navigation-announcer';

/* A bare live region, with no `role`.
 *
 * It used to carry `role="status"` AND `aria-live="assertive"`, which
 * contradict each other: `role="status"` has an implicit
 * `aria-live="polite"`, so the element declared itself both polite and
 * assertive and each screen reader picked a winner. The explicit
 * `aria-live` is the one that says what was meant, so the role goes
 * rather than the attribute — `role="alert"` would agree with assertive
 * but also claim the message is important and time-sensitive, which a
 * page title is not. */
const ensureAnnouncer = () => {
	const existing = document.getElementById(ANNOUNCER_ID);
	if (existing) return existing;
	const region = document.createElement('div');
	region.id = ANNOUNCER_ID;
	region.setAttribute('aria-live', 'assertive');
	region.setAttribute('aria-atomic', 'true');
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

/* Where focus goes after a soft navigation, in the order worth trying:
 * the page's own `autofocus`, then the new content's heading, then the
 * main landmark. The heading before the landmark because it both moves
 * focus past the navigation AND names the page. */
export const FOCUS_TARGETS = [
	'main h1',
	'[role="main"] h1',
	'h1',
	'main',
	'[role="main"]'
];

/* Tried in order, one `querySelector` each, rather than as one selector
 * list. A list returns the first match in DOCUMENT order, not the first
 * selector that matches — so `main h1, main` hands back the `<main>` that
 * encloses the heading, and focus lands on the whole content region
 * instead of on its title. A test caught exactly that. */
const findFocusTarget = () => {
	for (const selector of FOCUS_TARGETS) {
		const found = document.querySelector<HTMLElement>(selector);
		if (found) return found;
	}

	return null;
};

/* Only when focus did not land in the new content. Moving focus to the
 * heading already makes a screen reader read it, so announcing as well
 * says the same thing twice — the live region is the fallback for a page
 * with nothing to focus, not a second channel. */
export const announcePage = (focusMoved: boolean) => {
	if (focusMoved) return;
	const heading = document.querySelector('h1')?.textContent?.trim();
	const text = document.title || heading || window.location.pathname;
	ensureAnnouncer().textContent = text;
};

/** Returns whether focus was moved into the new content, which decides
 *  whether the page is also announced. */
export const resetFocus = () => {
	const autofocus = document.querySelector<HTMLElement>('[autofocus]');
	if (autofocus) {
		autofocus.focus();

		return true;
	}

	const target = findFocusTarget();
	if (!target) {
		/* Nothing to focus: send focus back to the top of the document so
		 * the next Tab starts from the new page rather than from wherever
		 * the old one left it. This is what the whole function used to do,
		 * and on its own it tells a screen reader nothing — hence the
		 * announcement. */
		if (document.activeElement instanceof HTMLElement)
			document.activeElement.blur();

		return false;
	}

	/* A heading is not focusable, so it is made focusable for this. -1
	 * keeps it out of the tab sequence: it can be focused by script but
	 * not tabbed to, so the page's tab order is unchanged.
	 *
	 * `preventScroll` because scroll is not this function's business —
	 * `reapplyScroll` runs later and decides where the page sits,
	 * including restoring a saved position on a traversal. Without it the
	 * browser would scroll the heading into view first and the page would
	 * visibly jump. */
	const hadTabIndex = target.hasAttribute('tabindex');
	if (!hadTabIndex) target.setAttribute('tabindex', '-1');
	target.focus({ preventScroll: true });
	/* Programmatic focus does not match `:focus-visible`, so no focus ring
	 * is drawn on the heading — the ring stays for the keyboard users it
	 * is for. */
	if (!hadTabIndex)
		target.addEventListener(
			'blur',
			() => {
				target.removeAttribute('tabindex');
			},
			{ once: true }
		);

	return true;
};
