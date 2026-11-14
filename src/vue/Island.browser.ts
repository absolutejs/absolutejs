import { defineComponent, h } from 'vue';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';
import { normalizeRuntimeIslandRenderProps } from '../core/normalizeIslandProps';
import {
	hydratedIslandStyleLink,
	withIslandStyleLink
} from './islandStyleLink';

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
		/* Accept either an object or a JSON-serialized string — see
		   the SSR `Island.ts` for the rationale. */
		props: {
			required: false,
			type: [Object, String]
		}
	},
	setup(rawProps) {
		const props = normalizeRuntimeIslandRenderProps(rawProps);
		const styleLink = hydratedIslandStyleLink(props);

		return () => {
			const { attributes, innerHTML } = preserveIslandMarkup(props);

			return withIslandStyleLink(
				styleLink,
				h('div', {
					...attributes,
					'data-allow-mismatch': '',
					innerHTML
				})
			);
		};
	}
});
