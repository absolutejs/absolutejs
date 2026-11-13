import { Suspense } from 'react';
import { Counter } from '../components/Counter';

type HomeProps = { greeting: string };

const loadItems = async () => {
	await Bun.sleep(50);

	return ['alpha', 'beta', 'gamma'];
};

/* An async server component: it awaits data on the server and ships only
 * the rendered result. Bun.sleep proves this code never reaches a browser. */
const ItemList = async () => {
	const items = await loadItems();

	return (
		<ul data-testid="items">
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
};

const SlowNote = async () => {
	await Bun.sleep(300);

	return <p data-testid="slow-note">streamed after the shell</p>;
};

export const Home = async ({ greeting }: HomeProps) => (
	<html lang="en">
		<head>
			<meta charSet="utf-8" />
			<title>RSC fixture</title>
		</head>
		<body>
			<h1 data-testid="greeting">{greeting}</h1>
			<p data-testid="runtime">rendered by Bun {Bun.version}</p>
			<ItemList />
			<Counter initialCount={5} label="Count" />
			<Suspense fallback={<p data-testid="slow-note">loading…</p>}>
				<SlowNote />
			</Suspense>
		</body>
	</html>
);
