import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type StreamSlotProps = {
	className?: string;
	/** Stream this slot on every request even when the page is
	 *  pre-rendered (partial prerendering): the cached shell keeps the
	 *  fallback. Set it on anything that reads the request or must be fresh. */
	dynamic?: boolean;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

export const StreamSlot = ({
	className,
	dynamic,
	errorHtml,
	fallbackHtml = '',
	id,
	resolve,
	timeoutMs
}: StreamSlotProps) => {
	if (isStreamingSlotCollectionActive()) {
		registerStreamingSlot({
			dynamic,
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
