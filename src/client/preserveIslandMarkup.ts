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

const getClaimMap = () => {
	if (typeof window === 'undefined') {
		return null;
	}

	window.__ABS_CLAIMED_ISLAND_MARKUP__ ??= new Map<string, number>();

	return window.__ABS_CLAIMED_ISLAND_MARKUP__;
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
	const attributes = Object.fromEntries(
		element
			.getAttributeNames()
			.map((name) => [name, element.getAttribute(name) ?? ''])
	);
	existing.push({
		attributes,
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

	const claimMap = getClaimMap();
	const snapshotMap = getSnapshotMap();
	const signature = getIslandSignature(props);
	const claimedCount = claimMap?.get(signature) ?? 0;
	const snapshotCandidate = snapshotMap?.get(signature)?.[claimedCount];
	const candidates = Array.from(
		document.querySelectorAll('[data-island="true"]')
	).filter((element) => isMatchingIslandElement(element, props));
	const candidate = candidates[claimedCount];
	if (claimMap) {
		claimMap.set(signature, claimedCount + 1);
	}

	return {
		attributes:
			snapshotCandidate?.attributes ?? getIslandMarkerAttributes(props),
		innerHTML: snapshotCandidate?.innerHTML ?? candidate?.innerHTML ?? ''
	};
};
