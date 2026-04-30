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
class LoadChildrenSsrTestPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];

export const page = defineAngularPage({ component: LoadChildrenSsrTestPage });
