<script lang="ts">
	import {
		isStreamingSlotCollectionActive,
		registerStreamingSlot,
		warnMissingStreamingSlotCollector
	} from '../../core/streamingSlotRegistrar';

	type Resolver = () => Promise<string> | string;

	let {
		className,
		errorHtml,
		fallbackHtml = '',
		id,
		resolve,
		timeoutMs
	}: {
		className?: string;
		errorHtml?: string;
		fallbackHtml?: string;
		id: string;
		resolve: Resolver;
		timeoutMs?: number;
	} = $props();

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
</script>

<div class={className} data-absolute-slot="true" {id}>
	{@html fallbackHtml}
</div>
