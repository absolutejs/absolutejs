import '@angular/compiler';
import { AsyncPipe } from '@angular/common';
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';

@Component({
	imports: [AsyncPipe, ReactiveFormsModule],
	selector: 'compile-dependency-home',
	standalone: true,
	template: `
		<main>
			<h1>{{ title$ | async }}</h1>
			<input [formControl]="control" />
			<p class="dependency-status">{{ control.value }}</p>
		</main>
	`
})
export class HomePage {
	control = new FormControl('ANGULAR_FORMS_READY', { nonNullable: true });
	title$ = of('DEPENDENCY_STRESS_HOME');
}

export const page = { component: HomePage };
