import { useState } from 'react';

type AppProps = { initialCount: number };

export const App = ({ initialCount }: AppProps) => {
	const [count, setCount] = useState(initialCount);

	return (
		<main>
			<nav>
				<a href="https://absolutejs.com" target="_blank">
					<img
						alt="AbsoluteJS Logo"
						className="logo"
						src="/assets/png/absolutejs-temp.png"
					/>
				</a>
				<a href="https://react.dev/">
					<img
						alt="React Logo"
						className="logo react"
						src="/assets/svg/react.svg"
					/>
				</a>
			</nav>
			<h1>AbsoluteJS + Reactxxxx</h1>
			<button onClick={() => setCount(count + 1)}>
				count is xxxx{count}
			</button>
			<p>
				Edit <code>example/react/pages/ReactExample.tsx</code> and save
				to test HMR.
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
