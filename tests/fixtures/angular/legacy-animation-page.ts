import { Component, inject, ANIMATION_MODULE_TYPE } from '@angular/core';
import {
	animate,
	state,
	style,
	transition,
	trigger
} from '@angular/animations';
import { provideAnimations } from '@angular/platform-browser/animations';

@Component({
	animations: [
		trigger('fade', [
			state('visible', style({ opacity: 1 })),
			transition(':enter', [style({ opacity: 0 }), animate('1ms')])
		])
	],
	selector: 'abs-legacy-animation-test-page',
	standalone: true,
	template: `
		<main>
			<p id="animation-module-type">{{ animationModuleType }}</p>
			<section [@fade]="'visible'">legacy animation content</section>
		</main>
	`
})
export class AngularLegacyAnimationTestPage {
	readonly animationModuleType =
		inject(ANIMATION_MODULE_TYPE, { optional: true }) ?? 'missing';
}

export const providers = [provideAnimations()];
