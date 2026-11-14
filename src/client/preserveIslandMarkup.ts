import type { RuntimeIslandRenderProps } from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';

type PreservedIslandMarkup = {
	attributes: Record<string, string>;
	innerHTML: string;
};

type IslandMarkerElement = HTMLElement & {
	dataset: DOMStringMap & {
		component?: string;
		framework?: string;
		hydrate?: string;
		island?: string;
		islandId?: string;
		props?: string;
	};
};

const getSnapshotMap = () => {
	if (typeof window === 'undefined') {
		return null;
	}

	window.__ABS_SERVER_ISLAND_HTML__ ??= new Map<
		string,
		PreservedIslandMarkup[]
	>();

	return window.__ABS_SERVER_ISLAND_HTML__;
};

const getIslandSignature = (props: RuntimeIslandRenderProps) => {
	const attributes = getIslandMarkerAttributes(props);

	return [
		attributes['data-component'],
		attributes['data-framework'],
		attributes['data-hydrate'],
		attributes['data-props']
	].join('::');
};

const isMatchingIslandElement = (
	element: Element,
	props: RuntimeIslandRenderProps
): element is IslandMarkerElement => {
	if (!(element instanceof HTMLElement)) {
		return false;
	}

	const attributes = getIslandMarkerAttributes(props);

	return (
		element.dataset.island === 'true' &&
		element.dataset.component === attributes['data-component'] &&
		element.dataset.framework === attributes['data-framework'] &&
		(element.dataset.hydrate ?? 'load') === attributes['data-hydrate'] &&
		(element.dataset.props ?? '{}') === attributes['data-props']
	);
};

/* Attributes the island runtime adds while hydrating. A host framework that
 * re-creates the marker (a remount, an HMR update) must not copy them, or the
 * runtime takes the new, unhydrated marker for a hydrated one and leaves it
 * dead. */
const RUNTIME_ISLAND_ATTRIBUTES = new Set(['data-error', 'data-hydrated']);

const readMarkerAttributes = (element: Element) =>
	Object.fromEntries(
		element
			.getAttributeNames()
			.filter((name) => !RUNTIME_ISLAND_ATTRIBUTES.has(name))
			.map((name) => [name, element.getAttribute(name) ?? ''])
	);

const snapshotIslandElement = (
	element: HTMLElement,
	snapshotMap: Map<string, PreservedIslandMarkup[]>
) => {
	const signature = [
		element.dataset.component,
		element.dataset.framework,
		element.dataset.hydrate ?? 'load',
		element.dataset.props ?? '{}'
	].join('::');
	const existing = snapshotMap.get(signature) ?? [];
	existing.push({
		attributes: readMarkerAttributes(element),
		innerHTML: element.innerHTML
	});
	snapshotMap.set(signature, existing);
};

export const initializeIslandMarkupSnapshot = () => {
	if (typeof document === 'undefined') {
		return;
	}

	const snapshotMap = getSnapshotMap();
	if (!snapshotMap || snapshotMap.size > 0) {
		return;
	}

	const elements = Array.from(
		document.querySelectorAll<HTMLElement>('[data-island="true"]')
	);
	for (const element of elements) {
		snapshotIslandElement(element, snapshotMap);
	}
};

export const preserveIslandMarkup = (props: RuntimeIslandRenderProps) => {
	if (typeof document === 'undefined') {
		return {
			attributes: getIslandMarkerAttributes(props),
			innerHTML: ''
		};
	}

	const snapshotMap = getSnapshotMap();
	const signature = getIslandSignature(props);
	// Islands that share a signature (same component, framework, hydrate mode
	// and serialized props) produce byte-identical SSR markup, so the first
	// captured snapshot is correct for every instance. Returning it
	// unconditionally keeps this stateless: React may call the component many
	// times during a single hydration (StrictMode double-render, hydration
	// retries, mismatch regeneration), and a per-call claim counter would run
	// past the snapshot list and yield empty markup — making the host render
	// `dangerouslySetInnerHTML={{ __html: '' }}` and wipe the island's
	// server-rendered DOM before the island runtime can hydrate it.
	const snapshotCandidate = snapshotMap?.get(signature)?.[0];
	if (snapshotCandidate) {
		return snapshotCandidate;
	}

	// Snapshot not captured yet (the island runtime module hasn't evaluated):
	// fall back to reading the live SSR DOM directly.
	const liveCandidate = Array.from(
		document.querySelectorAll('[data-island="true"]')
	).find((element) => isMatchingIslandElement(element, props));
	if (!liveCandidate) {
		return {
			attributes: getIslandMarkerAttributes(props),
			innerHTML: ''
		};
	}

	return {
		attributes: readMarkerAttributes(liveCandidate),
		innerHTML: liveCandidate.innerHTML
	};
};

const claimedServerIslands = new WeakSet<Element>();

/* A host framework whose render must reproduce a stylesheet link the server
 * streamed right before an island (Vue, see vue/islandStyleLink.ts) asks
 * here whether its island has one. Each browser-side Island instance takes
 * the first server island element with its signature that no instance has
 * taken yet (instances set up in document order while hydrating), and gets
 * the `<link data-island-style>` just before it, if any. Reading the DOM
 * keeps hydration exact whatever order the server rendered the islands in.
 * Null on a browser-only render: no server element is left to take. */
export const claimServerIslandStyleLink = (props: RuntimeIslandRenderProps) => {
	if (typeof document === 'undefined') return null;

	const element = Array.from(
		document.querySelectorAll('[data-island="true"]')
	).find(
		(candidate) =>
			!claimedServerIslands.has(candidate) &&
			isMatchingIslandElement(candidate, props)
	);
	if (!element) return null;
	claimedServerIslands.add(element);

	const previous = element.previousSibling;
	if (!(previous instanceof HTMLLinkElement)) return null;
	const key = previous.dataset.islandStyle;
	const href = previous.getAttribute('href');

	return key && href ? { href, key } : null;
};

/* React 19 compares `dangerouslySetInnerHTML` by object identity and rewrites
 * `innerHTML` whenever the object changes. A fresh `{ __html }` per render
 * made every host re-render (state change, Fast Refresh) replace the island's
 * hydrated DOM with its server markup, leaving a dead copy on screen. One
 * object per markup string keeps the boundary untouched. */
type InnerHtml = { __html: string };

const innerHtmlObjects = new Map<string, InnerHtml>();

export const getStableInnerHtml = (html: string) => {
	const existing = innerHtmlObjects.get(html);
	if (existing) return existing;
	const created: InnerHtml = { __html: html };
	innerHtmlObjects.set(html, created);

	return created;
};
