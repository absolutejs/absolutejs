import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

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
	styles: [
		`
			.dropdown {
				position: relative;
			}

			summary {
				cursor: pointer;
				padding: 0.5rem 1rem;
				list-style: none;
				appearance: none;
				-webkit-appearance: none;
				user-select: none;
				color: #5fbeeb;
				font-size: 1.5rem;
				font-weight: 500;
			}

			summary::-webkit-details-marker {
				display: none;
			}

			summary::after {
				content: '▼';
				display: inline-block;
				margin-left: 0.5rem;
				font-size: 0.75rem;
				transition: transform 0.3s ease;
			}

			details[open] summary::after {
				transform: rotate(180deg);
			}

			.menu {
				position: absolute;
				top: 100%;
				right: -0.5rem;
				display: flex;
				flex-direction: column;
				gap: 0.75rem;
				background: rgba(128, 128, 128, 0.15);
				backdrop-filter: blur(4px);
				border: 1px solid #5fbeeb;
				border-radius: 1rem;
				padding: 1rem 1.5rem;
				box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
				opacity: 0;
				transform: translateY(-8px);
				pointer-events: none;
				transition:
					opacity 0.3s ease,
					transform 0.3s ease;
				z-index: 1000;
			}

			details[open] .menu {
				opacity: 1;
				transform: translateY(0);
				pointer-events: auto;
			}

			.menu a {
				font-size: 1.1rem;
				padding: 0.25rem 0;
				white-space: nowrap;
				color: #5fbeeb;
				text-decoration: none;
			}

			.menu a::after {
				content: '';
				position: absolute;
				left: 0;
				bottom: 0;
				width: 100%;
				height: 2px;
				background: linear-gradient(
					90deg,
					#5fbeeb 0%,
					#35d5a2 50%,
					#ff4b91 100%
				);
				transform: scaleX(0);
				transform-origin: left;
				transition: transform 0.25s ease-in-out;
			}

			.menu a:hover::after {
				transform: scaleX(1);
			}
		`
	]
})
export class DropdownComponent {}

