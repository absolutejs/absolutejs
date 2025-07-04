import { useState } from 'react';

type AppProps = { initialCount: number };

export const App = ({ initialCount }: AppProps) => {
	const [count, setCount] = useState(initialCount);

	return (
		<main>
			<nav>
				<a href="https://absolutejs.com" target="_blank">
					<img
						className="logo"
						src="/assets/png/absolutejs-temp.png"
						alt="AbsoluteJS Logo"
					/>
				</a>
				<a href="https://react.dev/">
					<img
						className="logo react"
						src="/assets/svg/react.svg"
						alt="React Logo"
					/>
				</a>
			</nav>
			<h1>AbsoluteJS + React</h1>
			<button onClick={() => setCount(count + 1)}>
				count is {count}
			</button>
			<p>
				Edit <code>example/react/pages/ReactExample.tsx</code> then save
				and refresh to update the page.
			</p>
			<p style={{ color: '#777' }}>
				( Hot Module Reloading is coming soon )
			</p>
			<p style={{ marginTop: '2rem' }}>
				Explore the other pages to see how AbsoluteJS seamlessly unifies
				multiple frameworks on a single server.
			</p>
			<p
				style={{
					color: '#777',
					fontSize: '1rem',
					marginTop: '2rem'
				}}
			>
				Click on the AbsoluteJS and React logos to learn more.
			</p>
		</main>
	);
};
