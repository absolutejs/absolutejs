import { defineComponent, h, onServerPrefetch } from 'vue';
import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { renderIslandResult } from '../core/renderIslandMarkup';

const defineRuntimeIslandComponent = (
	setup: (props: RuntimeIslandRenderProps) => () => ReturnType<typeof h>
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
		let markerAttributes = getIslandMarkerAttributes(props);
		let html = '';

		onServerPrefetch(async () => {
			const result = await renderIslandResult(registry, props);
			({ attributes: markerAttributes, html } = result);
		});

		return () =>
			h('div', {
				...markerAttributes,
				'data-allow-mismatch': '',
				innerHTML: isBrowser ? undefined : html
			});
	});
