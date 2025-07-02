  <script setup lang="ts">
  import { ref } from 'vue'
  
  const props = defineProps<{
    test: number
  }>()
  
  const count = ref(props.test)
  </script>

<template>
  <div class="counter">
    <p>Current count: {{ count }}</p>
    <button @click="count++">Increment</button>
  </div>
</template>


<style scoped>
.counter {
  display: flex;
  align-items: center;
  gap: 1rem;
}
button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
}
</style>
