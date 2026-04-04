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

	return slot?.innerHTML ?? buildFallbackMarkup(props);
};
