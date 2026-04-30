import '@angular/compiler';
import { Component } from '@angular/core';
import type { Routes } from '@angular/router';

@Component({
	selector: 'lazy-children-route-child',
	standalone: true,
	template: '<p id="lazy-children-route">lazy children route rendered</p>'
})
class LazyChildrenRouteChild {}

export const routes: Routes = [
	{
		component: LazyChildrenRouteChild,
		path: ''
	}
];
