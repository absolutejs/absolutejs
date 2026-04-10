<script lang="ts">
	import StreamSlot from './StreamSlot.svelte';

	type Resolver = () => Promise<string> | string;

	let {
		className,
		errorHtml,
		fallbackHtml = '',
		id,
		promise,
		resolve,
		timeoutMs
	}: {
		className?: string;
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
	{errorHtml}
	{fallbackHtml}
	{id}
	resolve={slotResolver}
	{timeoutMs}
/>
