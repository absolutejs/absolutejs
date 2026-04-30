import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import {
	Component,
	inject,
	InjectionToken,
	type Provider
} from '@angular/core';
import {
	provideRouter,
	RouterOutlet,
	type Routes,
	withEnabledBlockingInitialNavigation
} from '@angular/router';

export const ROUTE_PROVIDER_VALUE = new InjectionToken<string>(
	'ROUTE_PROVIDER_VALUE'
);

@Component({
	selector: 'route-provider-child',
	standalone: true,
	template: '<p id="route-provider-value">{{ value }}</p>'
})
export class RouteProviderChild {
	readonly value = inject(ROUTE_PROVIDER_VALUE);
}

const adminProviders: Provider[] = [
	{ provide: ROUTE_PROVIDER_VALUE, useValue: 'admin-route-provider' }
];
const settingsProviders: Provider[] = [
	{ provide: ROUTE_PROVIDER_VALUE, useValue: 'settings-route-provider' }
];
const routes: Routes = [
	{
		component: RouteProviderChild,
		path: 'admin',
		providers: adminProviders
	},
	{
		component: RouteProviderChild,
		path: 'settings',
		providers: settingsProviders
	}
];

@Component({
	imports: [RouterOutlet],
	selector: 'route-provider-test',
	standalone: true,
	template: '<router-outlet></router-outlet>'
})
class RouteProviderPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];

export { RouteProviderPage };

export const page = defineAngularPage({ component: RouteProviderPage });
