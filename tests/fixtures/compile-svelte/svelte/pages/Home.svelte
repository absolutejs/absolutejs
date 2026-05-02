<script>
	import { onMount } from 'svelte';

	let count = 0;
	let ready = 'SVELTE_CLIENT_PENDING';

	onMount(() => {
		ready = 'SVELTE_CLIENT_READY';
	});
</script>

<h1 class="svelte-compile-home">SVELTE_COMPILE_HOME</h1>
<p id="svelte-client-ready">{ready}</p>
<button id="svelte-increment" on:click={() => (count += 1)}>
	Svelte Count {count}
</button>
