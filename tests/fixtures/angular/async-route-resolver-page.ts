import { Component, inject, signal } from '@angular/core';
import {
	ActivatedRoute,
	provideRouter,
	RouterOutlet,
	type ResolveFn,
	type Routes,
	withEnabledBlockingInitialNavigation
} from '@angular/router';
import { withPendingTask } from '../../../src/angular/pendingTask';

type ResolvedData = {
	value: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dataResolver: ResolveFn<ResolvedData> = () =>
	withPendingTask(async () => {
		await delay(50);

		return { value: 42 };
	});

@Component({
	selector: 'abs-resolver-child',
	standalone: true,
	template: `<p id="resolved-value">{{ resolvedValue() }}</p>`
})
export class ResolverChildComponent {
	readonly resolvedValue = signal('missing');

	constructor() {
		inject(ActivatedRoute).data.subscribe((data) => {
			this.resolvedValue.set(
				String(
					(data['data'] as ResolvedData | undefined)?.value ??
						'missing'
				)
			);
		});
	}
}

const routes: Routes = [
	{
		component: ResolverChildComponent,
		path: 'resolver',
		resolve: { data: dataResolver }
	}
];

@Component({
	imports: [RouterOutlet],
	selector: 'abs-async-route-resolver-test-page',
	standalone: true,
	template: `<router-outlet></router-outlet>`
})
export class AngularAsyncRouteResolverTestPage {}

export const providers = [
	provideRouter(routes, withEnabledBlockingInitialNavigation())
];
