<script lang="ts">
	import {
		isStreamingSlotCollectionActive,
		registerStreamingSlot,
		unresolvedSlot,
		warnMissingStreamingSlotCollector
	} from '../../core/streamingSlotRegistrar';

	type Resolver = () => Promise<string> | string;

	let {
		className,
		dynamic,
		errorHtml,
		fallbackHtml = '',
		id,
		resolve,
		timeoutMs
	}: {
		className?: string;
		/** Stream on every request even when the page is pre-rendered
		 *  (partial prerendering); the cached shell keeps the fallback. */
		dynamic?: boolean;
		errorHtml?: string;
		fallbackHtml?: string;
		id: string;
		/** Left out when the route declares a hole with this slot's
		 *  `id`: the slot is then only the placeholder. */
		resolve?: Resolver;
		timeoutMs?: number;
	} = $props();

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
</script>

<div class={className} data-absolute-slot="true" {id}>
	{@html fallbackHtml}
</div>
