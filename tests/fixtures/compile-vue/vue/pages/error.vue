<script setup>
defineProps({
	error: {
		default: undefined,
		type: Object
	}
});
</script>

<template>
	<h1>VUE_ERROR_CONVENTION</h1>
	<p>{{ error?.message ?? '' }}</p>
</template>
