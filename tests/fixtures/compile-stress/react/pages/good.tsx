import { useEffect, useState } from 'react';

export function GoodPage() {
	const [count, setCount] = useState(0);
	const [clientReady, setClientReady] = useState('CLIENT_PENDING');

	useEffect(() => {
		setClientReady('CLIENT_READY');
	}, []);

	return (
		<html>
			<head>
				<title>Compile Stress</title>
				<link rel="stylesheet" href="/stress.css" />
			</head>
			<body>
				<h1>GOOD_PAGE</h1>
				<p className="status">STYLE_READY</p>
				<p id="client-ready">{clientReady}</p>
				<button id="increment" onClick={() => setCount(count + 1)}>
					Count {count}
				</button>
				<a href="/linked">Linked page</a>
			</body>
		</html>
	);
}
