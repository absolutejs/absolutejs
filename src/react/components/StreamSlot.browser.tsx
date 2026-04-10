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
	fallbackHtml = '',
	id
}: StreamSlotProps) => (
	<div
		className={className}
		dangerouslySetInnerHTML={{ __html: fallbackHtml }}
		data-absolute-slot="true"
		id={id}
		suppressHydrationWarning
	/>
);
