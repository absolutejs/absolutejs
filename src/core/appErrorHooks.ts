/* Which error hooks an Elysia app has registered.
 *
 * AbsoluteJS's static error page (createStaticErrorPlugin in prepare.ts) is a
 * fallback: it renders error.html for a route that throws on a page request
 * only when the app has no error handling of its own. Elysia runs global
 * error hooks in registration order and stops at the first that returns a
 * response (measured), and the AbsoluteJS plugin is used before the app adds
 * its own hooks — so without this check an `onError` registered after
 * `.use(absolutejs)` would never see those errors.
 *
 * There is no public API for this, and the alternative designs do not work.
 * Deferring instead of detecting — letting Elysia produce its default error
 * response and swapping it in `mapResponse` — was measured and rejected:
 * `mapResponse` does run on the error path, but `response` arrives
 * `undefined` whether the app returned its own 500 or nothing handled the
 * throw at all, so the two cases it has to tell apart are indistinguishable
 * there. A naive version overwrote the app's own error response.
 *
 * So the hook chain it is. What this file CAN do is make that dependency
 * loud: every reach into Elysia's internals below is typed against Elysia's
 * own declarations, so an upgrade that changes the shape fails `typecheck`
 * rather than silently changing behaviour. The runtime guards remain for
 * the case where the value is not what the types promise — finding nothing
 * then means the fallback keeps rendering error.html, which is the
 * behaviour from before this check existed.
 *
 * tests/unit/core/appErrorHooks.test.ts pins the behaviour against real
 * Elysia compositions. */

import type { AnyElysia } from 'elysia';

/* The property the whole file depends on. `satisfies keyof AnyElysia` is
 * the pin: rename it upstream and this line stops compiling. */
const HOOK_CHAIN_KEY = '~hookChain' satisfies keyof AnyElysia;

/** Elysia's hook chain node, taken from the instance type rather than
 *  restated, so it cannot drift from the version installed. */
type HookChain = NonNullable<AnyElysia[typeof HOOK_CHAIN_KEY]>;

/** The chain is a union: nodes that carry hooks and link to a parent, and
 *  nodes that only combine other chains. Both are walked — the second
 *  variant does not appear in any composition measured (plain use, array
 *  use, nested plugins, scoped `as('global')`, guards, groups, a plugin
 *  used twice), but it is declared, so a version that does produce one must
 *  not quietly hide an app's error hook behind it. */
type AddedNode = Extract<HookChain, { added: unknown }>;

/* Where a node continues. Keyed by the two variants so that a key removed
 * upstream is a type error here, not a branch that silently stops
 * following. */
const ADDED_LINKS = [
	'parent',
	'registration'
] satisfies readonly (keyof AddedNode)[];
const COMBINE_LINKS = [
	'combine',
	'over',
	'callback',
	'inner'
] satisfies readonly (keyof Exclude<HookChain, AddedNode>)[];

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const visitChain = (
	node: unknown,
	seen: Set<unknown>,
	found: Set<unknown>
): void => {
	if (!isObject(node) || seen.has(node)) return;
	seen.add(node);
	const { added } = node;
	/* Declared as `ErrorHandler[]`, but flattened defensively: this walks a
	 * value that crossed a package boundary. */
	if (isObject(added)) {
		for (const hook of [added['error']].flat())
			if (typeof hook === 'function') found.add(hook);
	}
	for (const key of [...ADDED_LINKS, ...COMBINE_LINKS])
		visitChain(node[key], seen, found);
};

/** Every error hook function reachable from an Elysia instance's hook chain:
 *  its own and those of the plugins it uses, at any depth, for global and
 *  scoped hooks propagated to it. Local hooks of a plugin used by the app
 *  don't propagate, so they aren't listed — nor are hooks scoped to a
 *  `guard` or a `group`, which is correct: they do not run for the routes
 *  this fallback covers. */
export const collectErrorHooks = (app: unknown) => {
	const found = new Set<unknown>();
	if (!isObject(app)) return found;
	visitChain(app[HOOK_CHAIN_KEY], new Set(), found);

	return found;
};

/** True when `app` has an error hook that `own` (the AbsoluteJS plugin) didn't
 *  bring with it, so the app handles errors itself. */
export const hasForeignErrorHook = (app: unknown, own: unknown) => {
	const ownHooks = collectErrorHooks(own);
	for (const hook of collectErrorHooks(app)) {
		if (!ownHooks.has(hook)) return true;
	}

	return false;
};
