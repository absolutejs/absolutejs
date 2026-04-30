import { Component, inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { defineAngularPage } from '../../../src/angular/page';
import { DropdownComponent } from '../components/dropdown.component';
import { AppComponent } from '../components/app.component';

// Injection tokens for component props
export const INITIAL_COUNT = new InjectionToken<number>('INITIAL_COUNT');

type AngularPageProps = {
	initialCount: number;
};

@Component({
	imports: [CommonModule, DropdownComponent, AppComponent],
	selector: 'angular-page',
	standalone: true,
	templateUrl: '../templates/angular-example.html'
})
export class AngularExampleComponent {
	initialCount: number = 0;

	constructor() {
		const initialCountToken = inject(INITIAL_COUNT, { optional: true });
		this.initialCount = initialCountToken ?? 0;
	}
}

export const page = defineAngularPage<AngularPageProps>({
	component: AngularExampleComponent
});
