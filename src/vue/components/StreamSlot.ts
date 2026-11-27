import { defineComponent, h, useSSRContext } from 'vue';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	unresolvedSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type StreamSlotProps = {
	className?: string;
	/** Stream this slot on every request even when the page is
	 *  pre-rendered (partial prerendering): the cached shell keeps the
	 *  fallback. Set it on anything that reads the request or must be
	 *  fresh. */
	dynamic?: boolean;
	errorHtml?: string;
	fallbackHtml: string;
	id: string;
	/** What the slot shows once it resolves. Left out when the route
	 *  declares a hole with this slot's `id` (`defineHoles`, or the
	 *  `holes` export of a file route's server module): the slot is
	 *  then only the placeholder, and the route's resolver fills it. */
	resolve?: () => Promise<string> | string;
	timeoutMs?: number;
};

export const StreamSlot = defineComponent({
	name: 'AbsoluteStreamSlot',
	props: {
		className: { default: undefined, type: String },
		dynamic: { default: undefined, type: Boolean },
		errorHtml: { default: undefined, type: String },
		fallbackHtml: { default: '', type: String },
		id: { required: true, type: String },
		resolve: {
			default: undefined,
			type: Function
		},
		timeoutMs: { default: undefined, type: Number }
	},
	setup(props: StreamSlotProps) {
		if (useSSRContext() !== undefined) {
			registerStreamSlotForSsr(props);
		}

		return () =>
			h('div', {
				class: props.className,
				'data-absolute-slot': 'true',
				id: props.id,
				innerHTML: props.fallbackHtml
			});
	}
});

const registerStreamSlotForSsr = (props: StreamSlotProps) => {
	if (!isStreamingSlotCollectionActive()) {
		warnMissingStreamingSlotCollector('StreamSlot');

		return;
	}

	registerStreamingSlot({
		dynamic: props.dynamic,
		errorHtml: props.errorHtml,
		fallbackHtml: props.fallbackHtml,
		id: props.id,
		resolve: props.resolve ?? unresolvedSlot(props.id),
		timeoutMs: props.timeoutMs
	});
};
