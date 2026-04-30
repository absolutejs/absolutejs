import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import { Component, inject } from '@angular/core';
import {
	type CanActivateFn,
	provideRouter,
	Router,
	RouterOutlet,
	type Routes,
	withEnabledBlockingInitialNavigation
} from '@angular/router';

const authGuard: CanActivateFn = () =>
	inject(Router).parseUrl('/login?from=protected');

@Component({
	selector: 'login-route-page',
	standalone: true,
	template: '<p id="login-route">login</p>'
})
export class LoginRoutePage {}

@Component({
	selector: 'protected-route-page',
	standalone: true,
	template: '<p id="protected-route">protected</p>'
})
export class ProtectedRoutePage {}

const routes: Routes = [
	{
		canActivate: [authGuard],
		component: ProtectedRoutePage,
		path: 'protected'
	},
	{
		component: LoginRoutePage,
		path: 'login'
	}
];

@Component({
	imports: [RouterOutlet],
	selector: 'route-guard-redirect-test',
	standalone: true,
	template: '<router-outlet></router-outlet>'
})
class RouteGuardRedirectPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];

export { RouteGuardRedirectPage };

export const page = defineAngularPage({ component: RouteGuardRedirectPage });
