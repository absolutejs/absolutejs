import { defineComponent, h } from 'vue';
import type { RuntimeIslandRenderProps } from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';

export const Island = defineComponent({
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
	setup(props: RuntimeIslandRenderProps) {
		return () => {
			const { attributes, innerHTML } = preserveIslandMarkup(props);

			return h('div', {
				...attributes,
				'data-allow-mismatch': '',
				innerHTML
			});
		};
	}
});
