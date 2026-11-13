/* Which error hooks an Elysia app has registered.
 *
 * AbsoluteJS's static error page (createStaticErrorPlugin in prepare.ts) is a
 * fallback: it renders error.html for a route that throws on a page request
 * only when the app has no error handling of its own. Elysia runs global
 * error hooks in registration order and stops at the first that returns a
 * response, so without this check an `onError` the app registers after
 * `.use(absolutejs)` would never see those errors.
 *
 * Elysia 2 has no public API to list hooks. They live in the instance's
 * `~hookChain`: each node holds the hooks it `added`, plus links to the
 * `parent` chain, the `registration` it was propagated from, and `refs` to
 * other chains. If that shape changes, collectErrorHooks finds nothing and
 * the fallback keeps rendering error.html (the behaviour before this check);
 * tests/unit/core/appErrorHooks.test.ts pins the shape so an Elysia upgrade
 * that changes it fails loudly. */

type HookChainNode = {
	added?: { error?: unknown };
	parent?: unknown;
	refs?: unknown;
	registration?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const visitChain = (
	node: unknown,
	seen: Set<unknown>,
	found: Set<unknown>
): void => {
	if (!isObject(node) || seen.has(node)) return;
	seen.add(node);
	const chain: HookChainNode = node;
	const errorHooks = chain.added?.error;
	for (const hook of [errorHooks].flat()) {
		if (typeof hook === 'function') found.add(hook);
	}
	visitChain(chain.parent, seen, found);
	visitChain(chain.registration, seen, found);
	const refs = Array.isArray(chain.refs) ? chain.refs : [chain.refs];
	for (const ref of refs) visitChain(ref, seen, found);
};

/** Every error hook function reachable from an Elysia instance's hook chain:
 *  its own and those of the plugins it uses, at any depth, for global and
 *  scoped hooks propagated to it. Local hooks of a plugin used by the app
 *  don't propagate, so they aren't listed. */
export const collectErrorHooks = (app: unknown) => {
	const found = new Set<unknown>();
	if (!isObject(app)) return found;
	visitChain(app['~hookChain'], new Set(), found);

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
