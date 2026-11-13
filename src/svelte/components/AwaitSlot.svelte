<script lang="ts">
	import StreamSlot from './StreamSlot.svelte';

	type Resolver = () => Promise<string> | string;

	let {
		className,
		dynamic,
		errorHtml,
		fallbackHtml = '',
		id,
		promise,
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
		promise?: Promise<string>;
		resolve?: Resolver;
		timeoutMs?: number;
	} = $props();

	const slotResolver = () => {
		if (resolve) return resolve();
		if (promise) return promise;

		return '';
	};
</script>

<StreamSlot
	{className}
	{dynamic}
	{errorHtml}
	{fallbackHtml}
	{id}
	resolve={slotResolver}
	{timeoutMs}
/>
