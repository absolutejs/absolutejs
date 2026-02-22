import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
// Import from source during development (will use @absolutejs/absolute in user projects)
import { getRegisterClientScript } from '../../../src/utils/getRegisterClientScript';

@Component({
	selector: 'app-dropdown',
	standalone: true,
	imports: [CommonModule],
	template: `
		<details class="dropdown">
			<summary>Pages</summary>
			<nav class="menu">
				<a href="/">HTML</a>
				<a href="/react">React</a>
				<a href="/svelte">Svelte</a>
				<a href="/vue">Vue</a>
				<a href="/angular">Angular</a>
				<a href="/htmx">HTMX</a>
			</nav>
		</details>
	`,
	styles: []
})
export class DropdownComponent implements OnInit {
	ngOnInit() {
		// Register client-side event listeners for dropdown hover behavior
		// This runs during SSR and the script will be injected into the HTML response
		// The script will execute on the client after Angular hydrates
		const registerScript = getRegisterClientScript();
		if (registerScript) {
			registerScript(() => {
				const details = document.querySelector('header app-dropdown details.dropdown') as HTMLDetailsElement | null;
				if (details && !(details as any).__dropdownListenersAttached) {
					(details as any).__dropdownListenersAttached = true;
					details.addEventListener('mouseenter', function () {
						details.open = true;
					});
					details.addEventListener('mouseleave', function () {
						details.open = false;
					});
				}
			});
		}
	}
}
