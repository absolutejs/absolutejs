<script>
	let { error } = $props();
</script>

<h1>SVELTE_ERROR_CONVENTION</h1>
<p>{error?.message ?? ''}</p>
