'use client';

import { useState } from 'react';

type CounterProps = { initialCount: number; label: string };

export const Counter = ({ initialCount, label }: CounterProps) => {
	const [count, setCount] = useState(initialCount);

	return (
		<button
			data-testid="counter"
			onClick={() => setCount((value) => value + 1)}
			type="button"
		>
			{label}: {count}
		</button>
	);
};
