import { useState } from 'react';

export const Dropdown = () => {
	const [isOpen, setIsOpen] = useState(false);

	return (
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
	);
};
