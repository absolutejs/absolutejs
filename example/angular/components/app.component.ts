import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CounterComponent } from './counter.component';

@Component({
	encapsulation: ViewEncapsulation.None,
	imports: [CommonModule, CounterComponent],
	selector: 'app-root',
	standalone: true,
	styles: [
		`
			code {
				background-color: #1a1a1a;
				padding: 0.2rem 0.4rem;
				border-radius: 0.25rem;
				font-size: 0.9em;
			}

			@media (prefers-color-scheme: light) {
				code {
					background-color: #f0f0f0;
				}
			}
		`
	],
	template: `
		<main>
			<nav>
				<a href="https://absolutejs.com" target="_blank">
					<img
						class="logo"
						src="/assets/png/absolutejs-temp.png"
						alt="AbsoluteJS Logo"
					/>
				</a>
				<a href="https://angular.dev/">
					<img
						class="logo angular"
						src="/assets/svg/angular.svg"
						alt="Angular Logo"
					/>
				</a>
			</nav>
			<h1>AbsoluteJS + Angular</h1>
			<app-counter [initialCount]="initialCount"></app-counter>
			<p>
				Edit <code>example/angular/pages/angular-example.ts</code> and
				save to test HMR.
			</p>
			<p style="margin-top: 2rem">
				Explore the other pages to see how AbsoluteJS seamlessly unifies
				multiple frameworks on a single server.
			</p>
			<p style="color: #777; font-size: 1rem; margin-top: 2rem">
				Click on the AbsoluteJS and Angular logos to learn more.
			</p>
		</main>
	`
})
export class AppComponent {
	@Input() initialCount: number = 0;
}
