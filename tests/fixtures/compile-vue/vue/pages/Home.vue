<template>
	<h1 class="vue-compile-home">VUE_COMPILE_HOME</h1>
	<p id="vue-client-ready">{{ ready }}</p>
	<button id="vue-increment" @click="count += 1">
		Vue Count {{ count }}
	</button>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

const count = ref(0);
const ready = ref('VUE_CLIENT_PENDING');

onMounted(() => {
	ready.value = 'VUE_CLIENT_READY';
});
</script>
