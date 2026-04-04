import type { RuntimeIslandRenderProps } from '../../types/island';
import { serializeIslandProps } from './islands';

type IslandMarkerAttributes = {
	'data-component': string;
	'data-framework': string;
	'data-hydrate': string;
	'data-island': 'true';
	'data-island-id'?: string;
	'data-props': string;
};

export const getIslandMarkerAttributes = (
	props: RuntimeIslandRenderProps,
	islandId?: string
): IslandMarkerAttributes => ({
	'data-component': props.component,
	'data-framework': props.framework,
	'data-hydrate': props.hydrate ?? 'load',
	'data-island': 'true',
	...(islandId ? { 'data-island-id': islandId } : {}),
	'data-props': serializeIslandProps(props.props)
});

const escapeHtmlAttribute = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

export const serializeIslandAttributes = (attributes: Record<string, string>) =>
	Object.entries(attributes)
		.map(([key, value]) => `${key}="${escapeHtmlAttribute(value)}"`)
		.join(' ');
