import { Component, inject, InjectionToken } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeadComponent } from '../components/head.component';
import { DropdownComponent } from '../components/dropdown.component';
import { AppComponent } from '../components/app.component';

// Injection tokens for component props
export const CSS_PATH = new InjectionToken<string>('CSS_PATH');
export const INITIAL_COUNT = new InjectionToken<number>('INITIAL_COUNT');

type AngularPageProps = {
	initialCount: number;
	cssPath: string;
};

@Component({
	selector: 'html',
	standalone: true,
	imports: [CommonModule, HeadComponent, DropdownComponent, AppComponent],
	template: `
		<app-head [cssPath]="cssPath"></app-head>
		<body>
			<header>
				<a href="/">AbsoluteJS</a>
				<app-dropdown></app-dropdown>
			</header>
			<app-root [initialCount]="initialCount"></app-root>
		</body>
	`
})
export class AngularExampleComponent {
	// Inject values from DI in constructor
	cssPath: string = '';
	initialCount: number = 0;
	
	constructor() {
		// Inject values from DI - must be in constructor for SSR
		const cssPathToken = inject(CSS_PATH, { optional: true });
		const initialCountToken = inject(INITIAL_COUNT, { optional: true });
		
		// Use injected values or fallback to defaults
		this.cssPath = cssPathToken ?? '';
		this.initialCount = initialCountToken ?? 0;
	}
}

export const AngularExample = (props: AngularPageProps) => {
	const component = new AngularExampleComponent();
	component.initialCount = props.initialCount;
	component.cssPath = props.cssPath;
	return component;
};
