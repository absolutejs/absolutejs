import {
	Component,
	inject,
	REQUEST,
	REQUEST_CONTEXT,
	RESPONSE_INIT
} from '@angular/core';

@Component({
	selector: 'abs-request-provider-test-page',
	standalone: true,
	template: `
		<main>
			<p id="request-url">{{ requestUrl }}</p>
			<p id="request-context">{{ requestContextValue }}</p>
		</main>
	`
})
export class AngularRequestProviderTestPage {
	private readonly request = inject(REQUEST, { optional: true });
	private readonly requestContext = inject(REQUEST_CONTEXT, {
		optional: true
	}) as { marker?: string } | null;
	private readonly responseInit = inject(RESPONSE_INIT, { optional: true });

	readonly requestUrl = this.request?.url ?? 'no-request';
	readonly requestContextValue = this.requestContext?.marker ?? 'no-context';

	constructor() {
		if (this.responseInit) {
			const headers = new Headers(this.responseInit.headers);
			headers.set('x-angular-ssr', 'request-token');
			this.responseInit.headers = headers;
			this.responseInit.status = 207;
		}
	}
}
