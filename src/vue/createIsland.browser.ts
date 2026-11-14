import { defineComponent, h, type VNode } from 'vue';
import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';
import {
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
	_registry: IslandRegistry<T>
) =>
	defineRuntimeIslandComponent((props) => {
		const { attributes, innerHTML } = preserveIslandMarkup(props);
		const styleLink = hydratedIslandStyleLink(props);

		return () =>
			withIslandStyleLink(
				styleLink,
				h('div', {
					...attributes,
					'data-allow-mismatch': '',
					innerHTML
				})
			);
	});
