import { useState } from 'react';
import { App } from '../components/App';
import { Head } from '../components/Head';

type ReactExampleProps = { initialCount: number; cssPath: string };

export const ReactExample = ({ initialCount, cssPath }: ReactExampleProps) => {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<html>
			<Head cssPath={cssPath} />
			<body>
				<header>
					<a href="/">AbsoluteJS</a>
					<details
						onPointerEnter={() => setIsOpen(true)}
						onPointerLeave={() => setIsOpen(false)}
						open={isOpen}
					>
						<summary>Pages</summary>
						<nav>
							<a href="/html">HTML</a>
							<a href="/react">React</a>
							<a href="/htmx">HTMX</a>
							<a href="/svelte">Svelte</a>
							<a href="/vue">Vue</a>
							<a href="/angular">Angular</a>
						</nav>
					</details>
				</header>
				<App initialCount={initialCount} />
			</body>
		</html>
	);
};
