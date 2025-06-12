import { useState } from "react";

export const ReactExample = ({ test }: { test: number }) => {
	const [count, setCount] = useState(test);
	const year = new Date().getFullYear();

	return (
		<html>
			<head>
				<meta charSet="utf-8" />
				<title>React Home</title>
				<meta name="description" content="Welcome to AbsoluteJS" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1"
				/>
				<link rel="stylesheet" href="/assets/css/ReactHome.css" />
				<link rel="icon" href="/assets/ico/favicon.ico" />
			</head>
			<body>
				<main>
					<header>
						<h1>This page was built with React</h1>
					</header>
					<p>
						Welcome to the React home page. This page was built
						using React.
					</p>
					<p>Counter: {count}</p>
					<button onClick={() => setCount(count + 1)}>
						Increment
					</button>
					<div id="links">
						<a href="/">Html</a>
						<a href="/vue">Vue</a>
					</div>
					<footer>
						<p>© {year} AbsoluteJS</p>
					</footer>
				</main>
			</body>
		</html>
	);
};
