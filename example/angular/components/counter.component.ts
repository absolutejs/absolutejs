import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
	selector: 'app-counter',
	standalone: true,
	imports: [CommonModule],
	template: ` <button (click)="increment()">count is {{ count }}</button> `,
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
export class CounterComponent {
	@Input() initialCount: number = 0;
	count: number = 0;

	ngOnInit() {
		this.count = this.initialCount;
	}

	increment() {
		this.count++;
	}
}

