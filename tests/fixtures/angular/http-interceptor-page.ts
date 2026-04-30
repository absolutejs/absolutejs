import '@angular/compiler';
import { defineAngularPage } from '../../../src/angular/page';
import {
	HttpClient,
	type HttpHandlerFn,
	type HttpInterceptorFn,
	type HttpRequest,
	provideHttpClient,
	withFetch,
	withInterceptors
} from '@angular/common/http';
import {
	Component,
	inject,
	PendingTasks,
	signal,
	type EnvironmentProviders
} from '@angular/core';
import { REQUEST } from '../../../src/angular/requestProviders';

const absoluteSsrInterceptor: HttpInterceptorFn = (
	request: HttpRequest<unknown>,
	next: HttpHandlerFn
) => {
	const ssrRequest = inject(REQUEST, { optional: true });
	const cookie = ssrRequest?.headers.get('cookie') ?? 'missing-cookie';

	return next(
		request.clone({
			setHeaders: {
				'x-absolute-cookie': cookie,
				'x-absolute-interceptor': 'hit'
			}
		})
	);
};

@Component({
	selector: 'http-interceptor-ssr-test-page',
	standalone: true,
	template: `
		<p id="http-interceptor-cookie">{{ cookie() }}</p>
		<p id="http-interceptor-marker">{{ marker() }}</p>
	`
})
class HttpInterceptorSsrTestPage {
	private readonly http = inject(HttpClient);
	private readonly pendingTasks = inject(PendingTasks);
	readonly cookie = signal('pending');
	readonly marker = signal('pending');

	ngOnInit() {
		const removeTask = this.pendingTasks.add();

		void this.loadHttpState(removeTask);
	}

	private async loadHttpState(removeTask: () => void) {
		try {
			const response = await this.http
				.get<{
					cookie: string;
					marker: string;
				}>('https://absolute.test/api/interceptor', {
					transferCache: false
				})
				.toPromise();

			this.cookie.set(response?.cookie ?? 'missing-response');
			this.marker.set(response?.marker ?? 'missing-response');
		} catch {
			this.cookie.set('error');
			this.marker.set('error');
		} finally {
			removeTask();
		}
	}
}

export const providers: EnvironmentProviders[] = [
	provideHttpClient(withFetch(), withInterceptors([absoluteSsrInterceptor]))
];

export const page = defineAngularPage({
	component: HttpInterceptorSsrTestPage
});
