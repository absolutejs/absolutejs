import { ref } from 'vue';

export const useCount = (initialCount: number) => {
	const count = ref(initialCount);

	const increment = () => {
		count.value++;
	};

	return {
		count,
		increment
	};
};
