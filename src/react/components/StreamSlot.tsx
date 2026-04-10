import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type StreamSlotProps = {
	className?: string;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

export const StreamSlot = ({
	className,
	errorHtml,
	fallbackHtml = '',
	id,
	resolve,
	timeoutMs
}: StreamSlotProps) => {
	if (isStreamingSlotCollectionActive()) {
		registerStreamingSlot({
			errorHtml,
			fallbackHtml,
			id,
			resolve,
			timeoutMs
		});
	} else {
		warnMissingStreamingSlotCollector('StreamSlot');
	}

	return (
		<div
			className={className}
			dangerouslySetInnerHTML={{ __html: fallbackHtml }}
			data-absolute-slot="true"
			id={id}
			suppressHydrationWarning
		/>
	);
};
