import type { RuntimeIslandRenderProps } from '../../types/island';
import {
	getIslandMarkerAttributes,
	serializeIslandAttributes
} from '../core/islandMarkupAttributes';

const getIslandSnapshot = (slotId: string) => {
	if (typeof window === 'undefined') {
		return null;
	}

	const snapshot = window.__ABS_SVELTE_ISLAND_HTML__;
	if (!snapshot || typeof snapshot !== 'object') {
		return null;
	}

	const value = snapshot[slotId];

	return typeof value === 'string' ? value : null;
};

const buildFallbackMarkup = (props: RuntimeIslandRenderProps) =>
	`<div ${serializeIslandAttributes(getIslandMarkerAttributes(props))}></div>`;

/* Fill an island slot only when it is empty.
 *
 * The slot's client template has no children at all, which is the whole
 * point: Svelte hydration leaves the DOM children of an element whose
 * template has none exactly where they are. An `{@html}` writes the markup
 * again, and an `{#if}` wrapped around one is worse — the block's
 * hydration anchors make Svelte remove the nodes between them, so the
 * island disappears.
 *
 * It matters because the islands runtime hydrates an island from its own
 * bootstrap, independently of the page: by the time a Svelte page
 * hydrates, the island in its slot can already be a live instance.
 * Rewriting the slot replaced those nodes, the runtime hydrated the new
 * copy, and the first instance was left running on nodes no longer in the
 * document — two instances and two disposers for one element, on every
 * load of every Svelte page with an island.
 *
 * A MOUNTING render still needs the markup, and gets it here: a
 * client-rendered page, a page whose server markup was discarded and an
 * HMR remount all build a fresh tree whose slots are empty. "Empty" is
 * the condition rather than a flag about which render this is, because it
 * is the question that actually matters, and it is asked of the DOM. */
export const absoluteIslandSlot = (
	node: HTMLElement,
	resolve: () => string
) => {
	if (node.querySelector('[data-island]') === null) {
		node.innerHTML = resolve();
	}
};

export const resolveIslandHtml = (
	slotId: string,
	props: RuntimeIslandRenderProps
) => {
	const snapshot = getIslandSnapshot(slotId);
	if (snapshot !== null) {
		return snapshot;
	}

	if (typeof document === 'undefined') {
		return buildFallbackMarkup(props);
	}

	const slot = document.querySelector<HTMLElement>(
		`[data-absolute-island-slot="${slotId}"]`
	);

	/* An EMPTY slot is not markup to reuse. This is only asked when the
	 * slot holds no island (see `absoluteIslandSlot`), and on a page the
	 * browser renders from nothing the slot is there and empty — `??`
	 * took that empty string as the answer, so the island's placeholder
	 * was never written and nothing ever mounted. */
	return slot?.innerHTML || buildFallbackMarkup(props);
};
