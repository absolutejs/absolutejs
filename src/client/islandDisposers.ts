/* Unmounting islands when the markup holding them goes away.
 *
 * A soft navigation replaces `<body>` (client/navigation.ts). Until this
 * existed, the old page's islands were never unmounted: their React roots,
 * Svelte instances, Vue apps and Angular component refs stayed alive with
 * their effects, timers, subscriptions and listeners, attached to nodes no
 * longer in the document. The first listed limitation of navigation phase
 * 1, and it compounds — every navigation left another page's worth.
 *
 * Why a registry on `globalThis` rather than a module-level one:
 *
 * Each framework's client pass bundles its own copy of
 * `@absolutejs/absolute/client`, so a module-level collection would be one
 * per bundle copy. The navigation layer that performs the swap is whichever
 * copy installed it, and the islands on the page may have been hydrated by
 * a different copy — a React page's layer tearing down a Svelte island, say.
 * A `Symbol.for` key is the same store in every copy. This is the pattern
 * the island store snapshot and the streaming-slot registrar already use.
 *
 * Why the hydrators register themselves: this module has no imports, so
 * importing it pulls in no framework. Each hydrator is loaded by a dynamic
 * import only when an island of that framework is on the page, and it
 * registers its own disposer there, so nothing here needs to know how to
 * unmount anything. */

/** A hydrated island and the call that tears it down. */
type IslandDisposer = {
	dispose: () => unknown;
	element: Element;
};

type DisposerStore = Set<IslandDisposer>;

const STORE_KEY = Symbol.for('absolute.islandDisposers');

const isDisposerStore = (value: unknown): value is DisposerStore =>
	value instanceof Set;

const store = () => {
	const existing: unknown = Reflect.get(globalThis, STORE_KEY);
	if (isDisposerStore(existing)) return existing;
	const created: DisposerStore = new Set();
	Reflect.set(globalThis, STORE_KEY, created);

	return created;
};

/* The store holds elements strongly, so anything that leaves without being
 * disposed would be held here instead — trading one leak for a smaller
 * one. Every pass drops entries whose element is no longer in the
 * document, which covers an island removed by its host framework rather
 * than by a navigation. A WeakSet cannot be iterated, so it cannot answer
 * "unmount everything under this node". */
const isDetached = (element: Element) =>
	typeof document === 'undefined' || !document.contains(element);

const runDisposer = async (entry: IslandDisposer, store_: DisposerStore) => {
	store_.delete(entry);
	try {
		await entry.dispose();
	} catch (error) {
		// One island failing to unmount must not keep the others mounted,
		// and must not abort the navigation that asked for this.
		console.error('[islands] Failed to unmount an island', error);
	}
};

/** Unmounts every island inside `root`, and prunes any whose element has
 *  since left the document. Resolves once each disposer has run; one that
 *  throws is logged and does not stop the rest. Returns how many ran.
 *
 *  `keep` spares an island from both halves of that: it is not unmounted
 *  for being inside `root`, and not pruned for being out of the document.
 *  A persisted island (navigation plan phase 5) is both at once — the
 *  navigation moves it through the incoming document on its way into the
 *  new body, so for an instant it belongs to neither — and the pruning
 *  that exists to stop a leak would otherwise unmount exactly the island
 *  the page asked to keep. */
export const disposeIslandsIn = async (
	root: Node,
	keep?: (element: Element) => boolean
) => {
	const disposers = store();
	const pending: Promise<void>[] = [];
	for (const entry of Array.from(disposers)) {
		if (keep?.(entry.element) === true) continue;
		const inside = root === entry.element || root.contains(entry.element);
		if (inside || isDetached(entry.element))
			pending.push(runDisposer(entry, disposers));
	}
	await Promise.all(pending);

	return pending.length;
};

/** How many hydrated islands are currently registered. For tests, and for
 *  the heap assertions in the navigation suite. */
export const registeredIslandCount = () => store().size;

/** Registers how to tear down the island hydrated into `element`,
 *  replacing any disposer already registered for it (a dev HMR remount
 *  creates a new root for the same element). */
export const registerIslandDisposer = (
	element: Element,
	dispose: () => unknown
) => {
	const disposers = store();
	for (const entry of disposers)
		if (entry.element === element) disposers.delete(entry);
	disposers.add({ dispose, element });
};
