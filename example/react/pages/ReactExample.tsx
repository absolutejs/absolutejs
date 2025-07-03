import { App } from '../components/App';
import { Head } from '../components/Head';

export const ReactExample = ({ initialCount }: { initialCount: number }) => (
	<html>
		<Head />
		<body>
			<header>
				<p>AbsoluteJS</p>
				<nav>
					<a href="/">HTML</a>
					<a href="/react">React</a>
					<a href="/svelte">Svelte</a>
					<a href="/vue">Vue</a>
					<a href="/angular">Angular</a>
					<a href="/htmx">HTMX</a>
				</nav>
			</header>
			<App initialCount={initialCount} />
		</body>
	</html>
);
