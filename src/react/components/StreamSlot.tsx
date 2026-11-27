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
	 *  fallback. Set it on anything that reads the request or must be fresh. */
	dynamic?: boolean;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	/** What the slot shows once it resolves. Left out when the route
	 *  declares a hole with this slot's `id` (`defineHoles`, or the
	 *  `holes` export of a file route's server module): the slot is
	 *  then only the placeholder, and the route's resolver fills it. */
	resolve?: () => Promise<string> | string;
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
			resolve: resolve ?? unresolvedSlot(id),
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
