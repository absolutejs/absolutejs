import { defineComponent, h } from 'vue';
import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';

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
	_registry: IslandRegistry<T>
) =>
	defineRuntimeIslandComponent((props) => {
		const { attributes, innerHTML } = preserveIslandMarkup(props);

		return () =>
			h('div', {
				...attributes,
				'data-allow-mismatch': '',
				innerHTML
			});
	});
