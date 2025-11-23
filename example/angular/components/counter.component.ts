import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
// Import from source during development (will use @absolutejs/absolute in user projects)
import { getRegisterClientScript } from '../../../src/utils/getRegisterClientScript';

@Component({
	selector: 'app-counter',
	standalone: true,
	imports: [CommonModule],
	template: ` <button>count is <span class="counter-value">{{ initialCount }}</span></button> `,
	styles: [
		`
			button {
				background-color: #1a1a1a;
				border: 1px solid transparent;
				border-radius: 0.5rem;
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
				cursor: pointer;
				font-family: inherit;
				font-size: 1.1rem;
				font-weight: 500;
				margin: 2rem 0;
				padding: 0.6rem 1.2rem;
				transition: border-color 0.25s;
			}
			button:hover {
				border-color: #dd0031;
			}
			button:focus,
			button:focus-visible {
				outline: 4px auto -webkit-focus-ring-color;
			}

			@media (prefers-color-scheme: light) {
				button {
					background-color: #ffffff;
				}
			}
		`
	]
})
export class CounterComponent implements OnInit {
	@Input() initialCount: number = 0;

	ngOnInit() {
		// Register client-side event listener for counter button
		// This runs during SSR and the script will be injected into the HTML response
		// The script will execute on the client after Angular hydrates
		const registerScript = getRegisterClientScript();
		if (registerScript) {
			registerScript(() => {
				const button = document.querySelector('app-counter button');
				const counterValue = document.querySelector('app-counter .counter-value');
				if (button && counterValue && !(button as any).__counterListenerAttached) {
					(button as any).__counterListenerAttached = true;
					// Initialize count from the current text content (set during SSR from initialCount)
					let count = parseInt(counterValue.textContent || '0', 10);
					
					button.addEventListener('click', () => {
						count++;
						if (counterValue) {
							counterValue.textContent = count.toString();
						}
					});
				}
			});
		}
	}
}

