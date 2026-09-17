<script setup lang="ts">
import { ref } from 'vue';
import Caption from './Caption.vue';
import { startingAmount } from '../shared/amount';
const amount = ref(startingAmount);
</script>
<template>
	<section>
		<Caption />
		<button id="package-picker-increment" @click="amount += 1">
			Package amount {{ amount }}
		</button>
	</section>
</template>
<style scoped>
#package-picker-increment {
	color: rgb(180, 120, 20);
}
</style>
