import { defineComponent, h, useSSRContext } from 'vue';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type StreamSlotProps = {
	className?: string;
	errorHtml?: string;
	fallbackHtml: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

export const StreamSlot = defineComponent({
	name: 'AbsoluteStreamSlot',
	props: {
		className: { default: undefined, type: String },
		errorHtml: { default: undefined, type: String },
		fallbackHtml: { default: '', type: String },
		id: { required: true, type: String },
		resolve: {
			required: true,
			type: Function
		},
		timeoutMs: { default: undefined, type: Number }
	},
	setup(props: StreamSlotProps) {
		if (useSSRContext() !== undefined) {
			if (isStreamingSlotCollectionActive()) {
				registerStreamingSlot({
					errorHtml: props.errorHtml,
					fallbackHtml: props.fallbackHtml,
					id: props.id,
					resolve: props.resolve,
					timeoutMs: props.timeoutMs
				});
			} else {
				warnMissingStreamingSlotCollector('StreamSlot');
			}
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
