<script setup>
defineProps({
	message: {
		default: '',
		type: String
	}
});
</script>

<template>
	<h1>VUE_ERROR_CONVENTION</h1>
	<p>{{ message }}</p>
</template>
