import { defineComponent, h, onServerPrefetch } from 'vue';
import type { RuntimeIslandRenderProps } from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
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

export const Island = defineRuntimeIslandComponent((props) => {
	const isBrowser = typeof window !== 'undefined';
	let markerAttributes = getIslandMarkerAttributes(props);
	let html = '';

	onServerPrefetch(async () => {
		const result = await renderIslandResult(
			requireCurrentIslandRegistry(),
			props
		);
		({ attributes: markerAttributes, html } = result);
	});

	return () => {
		const preserved = isBrowser ? preserveIslandMarkup(props) : null;

		return h('div', {
			...(preserved?.attributes ?? markerAttributes),
			'data-allow-mismatch': '',
			innerHTML: isBrowser ? preserved?.innerHTML : html
		});
	};
});
