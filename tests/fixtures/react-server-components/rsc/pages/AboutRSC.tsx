import {
	Link,
	StreamSlot,
	SuspenseSlot
} from '@absolutejs/absolute/react/components';

/* A server-component page whose file name already ends in RSC (manifest key
 * `AboutRSC`, not `AboutRSCRSC`) and that imports the React components entry
 * straight from a server component: the slots render on the server, Link
 * becomes a client reference. */
export const AboutRSC = () => (
	<html lang="en">
		<head>
			<meta charSet="utf-8" />
			<title>RSC about</title>
		</head>
		<body>
			<h1 data-testid="about">About</h1>
			<Link data-testid="home-link" href="/">
				Home
			</Link>
			<StreamSlot
				fallbackHtml="<p>stream slot loading</p>"
				id="stream-slot"
				resolve={() =>
					'<p data-testid="stream-slot">stream slot ready</p>'
				}
			/>
			<SuspenseSlot
				fallbackHtml="<p>suspense slot loading</p>"
				id="suspense-slot"
				resolve={() =>
					'<p data-testid="suspense-slot">suspense slot ready</p>'
				}
			/>
			{/* React-node slots: their content is rendered through Flight,
			    since react-dom/server is unavailable to server components. */}
			<SuspenseSlot
				fallback={<p>node slot loading</p>}
				id="node-slot"
				resolve={async () => (
					<p data-testid="node-slot">node slot ready</p>
				)}
			/>
			<SuspenseSlot
				fallback={<p>render slot loading</p>}
				id="render-slot"
				promise={Promise.resolve('render prop')}
			>
				{(value) => <p data-testid="render-slot">{value} ready</p>}
			</SuspenseSlot>
		</body>
	</html>
);
