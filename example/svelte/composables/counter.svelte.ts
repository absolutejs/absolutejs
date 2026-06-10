export const counter = (initialCount: number) => {
	let count = $state(initialCount);

	const getCount = () => count;

	const increment = () => {
		count += 1;
	};

	return {
		getCount,
		increment
	};
};
