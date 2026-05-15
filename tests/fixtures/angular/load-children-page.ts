import '@angular/compiler';
import { Component } from '@angular/core';
import {
	provideRouter,
	RouterOutlet,
	type Routes,
	withEnabledBlockingInitialNavigation
} from '@angular/router';

const routes: Routes = [
	{
		path: 'lazy-children',
		loadChildren: () =>
			import('./lazy-children.routes').then((module) => module.routes)
	}
];

@Component({
	imports: [RouterOutlet],
	selector: 'load-children-ssr-test-page',
	standalone: true,
	template: '<router-outlet></router-outlet>'
})
export class LoadChildrenSsrTestPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];
