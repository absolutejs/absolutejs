export const ABSOLUTE_TELEPORT_TARGET_ID = 'absolute-teleports';
export const ABSOLUTE_TELEPORT_TARGET = `#${ABSOLUTE_TELEPORT_TARGET_ID}`;

/** The page's `<body>`, as a teleport target (`<Teleport to="body">`). */
export const BODY_TELEPORT_TARGET = 'body';

/**
 * What a server render teleported, sorted by where it can go in the
 * document.
 *
 * Vue's SSR renderer collects a `<Teleport>`'s markup separately, keyed by
 * its `to`, and leaves placing it to the server. Hydration then looks for
 * it at a fixed place: a target's teleported content must be its FIRST
 * children (`hydrateTeleport` starts from `target.firstChild`, or from
 * where the previous teleport to that target ended). Content anywhere else
 * is not found, and Vue hydrates the teleport against whatever IS first in
 * the target: for `body` that is the page's own `#root`, so the mismatch
 * recovery replaces the page's markup and the teleport's components are
 * never created; the next update to them throws inside Vue.
 *
 * - `#absolute-teleports`: the framework's own target, rendered outside
 *   `#root` holding nothing else.
 * - `body`: placed directly after `<body>`, before `#root`.
 * - anything else (an element of the page itself): cannot be placed. Its
 *   content would have to be the element's first children, and an
 *   element that also renders children of its own then fails to hydrate.
 *   Vue does not support it either; it is reported, not silently dropped.
 */
export const sortTeleports = (
	teleports: Record<string, string> | undefined
) => {
	const rendered = teleports ?? {};
	const unplaceable = Object.keys(rendered).filter(
		(target) =>
			target !== ABSOLUTE_TELEPORT_TARGET &&
			target !== BODY_TELEPORT_TARGET &&
			rendered[target] !== ''
	);

	return {
		body: rendered[BODY_TELEPORT_TARGET] ?? '',
		framework: rendered[ABSOLUTE_TELEPORT_TARGET] ?? '',
		unplaceable
	};
};

const reported = new Set<string>();

/** Says, once per page and target, why a teleport's content is missing
 *  from the server's HTML and what to do about it. */
export const reportUnplaceableTeleports = (
	page: string,
	targets: string[],
	reason: 'element' | 'streaming'
) => {
	for (const target of targets) {
		const key = `${page}\u0000${target}\u0000${reason}`;
		if (reported.has(key)) continue;
		reported.add(key);
		console.warn(
			reason === 'streaming'
				? `[SSR] ${page}: <Teleport to="${target}"> can't be server-rendered on a streaming page: the start of <body> has already been sent when the render finishes. Teleport to "${ABSOLUTE_TELEPORT_TARGET}" instead; it renders after the page.`
				: `[SSR] ${page}: <Teleport to="${target}"> can't be server-rendered: a teleport into an element of the page itself doesn't hydrate. Teleport to "${ABSOLUTE_TELEPORT_TARGET}" or "${BODY_TELEPORT_TARGET}", or render it only after the page has mounted.`
		);
	}
};
