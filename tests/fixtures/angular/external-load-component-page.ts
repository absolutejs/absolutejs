import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { Component } from '@angular/core';
import {
	provideRouter,
	RouterOutlet,
	type Routes,
	withEnabledBlockingInitialNavigation
} from '@angular/router';

const routes: Routes = [
	{
		path: 'external-lazy',
		loadComponent: () =>
			import('@absolutejs-test/angular-lazy-package/lazy').then(
				(module) => module.ExternalLazyComponent
			)
	}
];

@Component({
	imports: [RouterOutlet],
	selector: 'external-load-component-test',
	standalone: true,
	template: '<router-outlet></router-outlet>'
})
export class ExternalLoadComponentPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];

export const page = defineAngularPage({ component: ExternalLoadComponentPage });
