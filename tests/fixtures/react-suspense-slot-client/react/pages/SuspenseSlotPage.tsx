import { createContext, useContext, useState } from 'react';
import { SuspenseSlot } from '@absolutejs/absolute/react/components';

const wait = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const record = (entry: string) => {
	/* Kept on the page, where the test reads which values were handed on. */
	const list = document.body.dataset.resolvedSlots;
	document.body.dataset.resolvedSlots = list ? `${list}|${entry}` : entry;
};

/* Provided above the slot: its content must see it, on the server too. */
const Unit = createContext('no context');

/* Interactive content: proves the streamed slot was taken over by React. */
const Counter = ({ start }: { start: number }) => {
	const [count, setCount] = useState(start);
	const unit = useContext(Unit);

	return (
		<button
			id="counter"
			onClick={() => setCount((current) => current + 1)}
			type="button"
		>
			{unit} {count}
		</button>
	);
};

/* Mounted after hydration, like a client-side navigation: no stream is
 * coming for it, so it resolves in the browser. */
const LateSlot = () => (
	<SuspenseSlot
		fallback={<p id="late-fallback">late loading</p>}
		id="slot-late"
		onResolved={(value: { label: string }) => record(`late:${value.label}`)}
		resolve={async () => {
			await wait(150);

			return { label: 'resolved in the browser' };
		}}
	>
		{(value: { label: string }) => <p id="late-value">{value.label}</p>}
	</SuspenseSlot>
);

/* The page's body: a static shell, a streamed slot, and a button that
 * mounts a second slot later. */
const SlotDemo = () => {
	const [late, setLate] = useState(false);

	return (
		<Unit.Provider value="count">
			<h1 id="shell">Static shell</h1>
			<SuspenseSlot
				fallback={<p id="count-fallback">count loading</p>}
				id="slot-count"
				onResolved={(value: { start: number }) =>
					record(`count:${value.start}`)
				}
				resolve={async () => {
					await wait(300);

					return { start: 3 };
				}}
			>
				{(value: { start: number }) => <Counter start={value.start} />}
			</SuspenseSlot>
			<button id="mount-late" onClick={() => setLate(true)} type="button">
				Mount late
			</button>
			{late && <LateSlot />}
		</Unit.Provider>
	);
};

export const SuspenseSlotPage = () => (
	<html lang="en">
		<head>
			<title>React SuspenseSlot Client Fixture</title>
		</head>
		<body>
			<main>
				<SlotDemo />
			</main>
		</body>
	</html>
);
