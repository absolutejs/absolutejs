import { Component, inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownComponent } from '../components/dropdown.component';
import { AppComponent } from '../components/app.component';

// Injection tokens for component props
export const INITIAL_COUNT = new InjectionToken<number>('INITIAL_COUNT');

type AngularPageProps = {
	initialCount: number;
};

@Component({
	selector: 'angular-page',
	standalone: true,
	imports: [CommonModule, DropdownComponent, AppComponent],
	template: `
		<header>
			<a href="/">AbsoluteJS</a>
			<app-dropdown></app-dropdown>
		</header>
		<app-root [initialCount]="initialCount"></app-root>
	`
})
export class AngularExampleComponent {
	initialCount: number = 0;

	constructor() {
		const initialCountToken = inject(INITIAL_COUNT, { optional: true });
		this.initialCount = initialCountToken ?? 0;
	}
}

export const AngularExample = (props: AngularPageProps) => {
	const component = new AngularExampleComponent();
	component.initialCount = props.initialCount;
	return component;
};
