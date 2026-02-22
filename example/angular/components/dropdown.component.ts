import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
	selector: 'app-dropdown',
	standalone: true,
	imports: [CommonModule],
	template: `
		<details class="dropdown" [attr.open]="isOpen ? '' : null"
			(mouseenter)="isOpen = true"
			(mouseleave)="isOpen = false">
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
export class DropdownComponent {
	isOpen = false;
}
