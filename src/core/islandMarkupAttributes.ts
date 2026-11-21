import type { RuntimeIslandRenderProps } from '../../types/island';
import { serializeIslandProps } from './islands';

type IslandMarkerAttributes = {
	'data-absolute-persist'?: string;
	'data-component': string;
	'data-framework': string;
	'data-hydrate': string;
	'data-island': 'true';
	'data-island-id'?: string;
	'data-props': string;
};

/* `data-absolute-persist` is read by the navigation layer, not by the
 * islands runtime: on a soft navigation it matches the live island against
 * an island with the same key on the page being swapped in, and moves the
 * live one across (client/navigation.ts). The attribute has to be in the
 * markup both the server and the client produce, so it belongs here with
 * the rest of the marker rather than in any one framework's component. */
export const getIslandMarkerAttributes = (
	props: RuntimeIslandRenderProps,
	islandId?: string
): IslandMarkerAttributes => ({
	...(props.persist === undefined
		? {}
		: { 'data-absolute-persist': props.persist }),
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
