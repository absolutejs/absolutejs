import {
	defineComponent,
	h,
	onServerPrefetch,
	useSSRContext,
	type VNode
} from 'vue';
import type { RuntimeIslandRenderProps } from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { normalizeRuntimeIslandRenderProps } from '../core/normalizeIslandProps';
import { renderIslandResult } from '../core/renderIslandMarkup';
import {
	claimInlineIslandStyleLink,
	hydratedIslandStyleLink,
	withIslandStyleLink
} from './islandStyleLink';

const defineRuntimeIslandComponent = (
	setup: (props: RuntimeIslandRenderProps) => () => VNode | VNode[]
) =>
	defineComponent({
		name: 'AbsoluteIsland',
		props: {
			component: {
				required: true,
				type: String
			},
			framework: {
				required: true,
				type: String
			},
			hydrate: {
				required: false,
				type: String
			},
			/* Accept either an object (the Vue-idiomatic
			   `:props="{ ... }"` form) or a JSON-serialized string
			   (mirrors the HTML `<absolute-island>` surface, so the
			   same template fragment is portable across hosts).
			   `normalizeRuntimeIslandRenderProps` validates the
			   shape at runtime. */
			props: {
				required: false,
				type: [Object, String]
			}
		},
		setup: (rawProps) => setup(normalizeRuntimeIslandRenderProps(rawProps))
	});

export const Island = defineRuntimeIslandComponent((props) => {
	const isBrowser = typeof window !== 'undefined';
	const ssrContext = isBrowser ? undefined : useSSRContext();
	let markerAttributes = getIslandMarkerAttributes(props);
	let html = '';
	let styleLink = isBrowser ? hydratedIslandStyleLink(props) : null;

	onServerPrefetch(async () => {
		const result = await renderIslandResult(
			requireCurrentIslandRegistry(),
			props
		);
		({ attributes: markerAttributes, html } = result);
		styleLink = claimInlineIslandStyleLink(ssrContext, props);
	});

	return () => {
		const preserved = isBrowser ? preserveIslandMarkup(props) : null;

		return withIslandStyleLink(
			styleLink,
			h('div', {
				...(preserved?.attributes ?? markerAttributes),
				'data-allow-mismatch': '',
				innerHTML: isBrowser ? preserved?.innerHTML : html
			})
		);
	};
});
