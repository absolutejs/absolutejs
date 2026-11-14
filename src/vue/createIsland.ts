import {
	defineComponent,
	h,
	onServerPrefetch,
	useSSRContext,
	type VNode
} from 'vue';
import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
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
			props: {
				required: true,
				type: Object
			}
		},
		setup
	});

export const createTypedIsland = <T extends IslandRegistryInput>(
	registry: IslandRegistry<T>
) =>
	defineRuntimeIslandComponent((props) => {
		const isBrowser = typeof window !== 'undefined';
		const ssrContext = isBrowser ? undefined : useSSRContext();
		let markerAttributes = getIslandMarkerAttributes(props);
		let html = '';
		let styleLink = isBrowser ? hydratedIslandStyleLink(props) : null;

		onServerPrefetch(async () => {
			const result = await renderIslandResult(registry, props);
			({ attributes: markerAttributes, html } = result);
			styleLink = claimInlineIslandStyleLink(ssrContext, props);
		});

		return () =>
			withIslandStyleLink(
				styleLink,
				h('div', {
					...markerAttributes,
					'data-allow-mismatch': '',
					innerHTML: isBrowser ? undefined : html
				})
			);
	});
