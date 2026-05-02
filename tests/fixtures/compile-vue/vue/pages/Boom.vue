<script setup>
const fail = () => {
	throw new Error('VUE_BOOM_FAILURE');
};
</script>

<template>
	<h1>{{ fail() }}</h1>
</template>
