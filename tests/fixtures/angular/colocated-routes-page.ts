/* eslint-disable absolute/sort-exports, absolute/angular-one-feature-per-file -- this fixture reproduces a page that declares its routed children in the same file, before the routes table that references them. */
import { Component } from '@angular/core';
import { RouterLink, RouterOutlet, type Routes } from '@angular/router';

@Component({
	selector: 'routed-a',
	standalone: true,
	template: '<p id="routed-a">Routed A</p>'
})
export class RoutedAComponent {}

@Component({
	selector: 'routed-b',
	standalone: true,
	template: '<p id="routed-b">Routed B</p>'
})
export class RoutedBComponent {}

export const routes: Routes = [
	{ component: RoutedAComponent, path: '' },
	{ component: RoutedBComponent, path: 'b' }
];

@Component({
	imports: [RouterLink, RouterOutlet],
	selector: 'colocated-routes-page',
	standalone: true,
	template:
		'<nav><a routerLink="b">B</a></nav><main id="shell"><router-outlet /></main>'
})
export class ColocatedRoutesPageComponent {}
