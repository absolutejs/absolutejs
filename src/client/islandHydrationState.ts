/* The islands runtime's per-document bookkeeping, kept on `globalThis`
 * rather than in the module.
 *
 * Two sets, both of which have to mean "this document", not "this copy of
 * this module":
 *
 *   - `hydrating`: the islands whose hydration has started and not
 *     finished. `hydrateIsland` adds an element before its first `await`
 *     and checks the set on entry, which makes a second call for the same
 *     element a no-op.
 *   - `observed`: the roots that already have a MutationObserver watching
 *     them for inserted islands, so a second bootstrap does not install a
 *     second observer.
 *
 * Module-level sets looked sufficient while the bootstrap evaluated once
 * per document. It does not. A soft navigation re-runs the incoming page's
 * module entries, and because a module URL evaluates only once per
 * document, `moduleUrlFor` (client/navigation.ts) deliberately gives the
 * revisit a fresh URL — `?absolute-nav=N` — so the entry runs again. The
 * islands bootstrap is one of those entries, so each visit to a page that
 * has islands produced ANOTHER instance of this runtime, with its own
 * sets and its own observer on the same root.
 *
 * Every instance then hydrated every island element inserted after it
 * started, each one past its own private guard: the component mounted
 * once per instance, and all but one of those mounts ran on nodes that
 * were immediately replaced, with their intervals, effects and
 * subscriptions still going. Measured on a page with one island, mounts
 * came to the square of the number of visits — 1, 4, 9, 16 — because both
 * the instance count and the elements each instance hydrates grow with
 * every visit.
 *
 * A `Symbol.for` key is the same store in every copy, which is the
 * pattern the disposer registry, the island store snapshot and the
 * streaming-slot registrar already use. */

type HydrationState = {
	hydrating: WeakSet<HTMLElement>;
	observed: WeakSet<Node>;
};

const STATE_KEY = Symbol.for('absolute.islandHydrationState');

const isHydrationState = (value: unknown): value is HydrationState =>
	typeof value === 'object' &&
	value !== null &&
	'hydrating' in value &&
	'observed' in value &&
	value.hydrating instanceof WeakSet &&
	value.observed instanceof WeakSet;

export const islandHydrationState = () => {
	const existing: unknown = Reflect.get(globalThis, STATE_KEY);
	if (isHydrationState(existing)) return existing;
	const created: HydrationState = {
		hydrating: new WeakSet<HTMLElement>(),
		observed: new WeakSet<Node>()
	};
	Reflect.set(globalThis, STATE_KEY, created);

	return created;
};
