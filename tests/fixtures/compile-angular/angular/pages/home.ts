import '@angular/compiler';
import { Component } from '@angular/core';

@Component({
	selector: 'compile-angular-home',
	standalone: true,
	template: `
		<main>
			<h1>ANGULAR_COMPILE_HOME</h1>
			<p class="angular-status">ANGULAR_STYLE_READY</p>
		</main>
	`
})
export class HomePage {}

export const page = { component: HomePage };
