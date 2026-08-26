import { Elysia, type AnyElysia } from 'elysia';
import { scopedState } from '@absolutejs/scoped-state';
import {
	auth,
	createInMemoryAuthorizationCodeStore,
	createInMemoryAuthSessionStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	createInMemorySocketTicketStore,
	generateSigningKey
} from '@absolutejs/auth';
import type * as AngularExamplePage from './angular/pages/angular-example';
import type SvelteExample from './svelte/pages/SvelteExample.svelte';
import type SpaShell from './vue/pages/SpaShell.vue';
import type VueExample from './vue/pages/VueExample.vue';
import { generateHeadElement } from '../src/utils/generateHeadElement';
import { ReactExample } from './react/pages/ReactExample';
import { NativeAuthSyncAcceptance } from './react/pages/NativeAuthSyncAcceptance';
import { NativeLocationAcceptance } from './react/pages/NativeLocationAcceptance';
import { NativeDocumentsAcceptance } from './react/pages/NativeDocumentsAcceptance';
import {
	asset,
	handleHTMLPageRequest,
	handleHTMXPageRequest,
	prepare
} from '../src';
import { handleAngularPageRequest } from '../src/angular';
import { handleEmberPageRequest } from '../src/ember';
import { networking } from '../src/plugins/networking';
import { handleReactPageRequest } from '../src/react';
import { handleSveltePageRequest } from '../src/svelte';
import { handleVuePageRequest } from '../src/vue';

const { absolutejs, manifest } = await prepare();
const nativeOidcIssuer =
	process.env.ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN ?? 'http://localhost:3000';
const nativeOidc = await auth<{ sub: string }>({
	authSessionStore: createInMemoryAuthSessionStore(),
	oidc: {
		authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
		clientStore: createInMemoryOAuthClientStore([]),
		issuer: nativeOidcIssuer,
		refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
		signingKey: await generateSigningKey(),
		socketTicketStore: createInMemorySocketTicketStore(),
		getClaims: () => ({}),
		getUserId: ({ sub }) => sub
	},
	providersConfiguration: {},
	getUser: (sub) => ({ sub })
});

export const server: AnyElysia = new Elysia()
	.use(absolutejs)
	.use(nativeOidc)
	.use(
		scopedState({
			count: { value: 0 }
		})
	)
	.get('/', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/html', () => handleHTMLPageRequest(asset(manifest, 'HTMLExample')))
	.get('/react', () => {
		const index = asset(manifest, 'ReactExampleIndex');
		const cssPath = asset(manifest, 'ReactExampleCSS');

		return handleReactPageRequest({
			index,
			Page: ReactExample,
			props: {
				cssPath,
				initialCount: 0
			}
		});
	})
	.get('/native-auth-sync', () => {
		const origin =
			process.env.ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN ??
			'http://localhost:39080';
		const syncUrl = new URL('/__absolute/native-sync', origin);
		syncUrl.protocol = syncUrl.protocol === 'https:' ? 'wss:' : 'ws:';

		return handleReactPageRequest({
			index: asset(manifest, 'NativeAuthSyncAcceptanceIndex'),
			Page: NativeAuthSyncAcceptance,
			props: {
				email: 'native-conformance@absolutejs.com',
				syncUrl: syncUrl.href
			}
		});
	})
	.get('/native-location', () =>
		handleReactPageRequest({
			index: asset(manifest, 'NativeLocationAcceptanceIndex'),
			Page: NativeLocationAcceptance,
			props: {}
		})
	)
	.get('/native-documents', () =>
		handleReactPageRequest({
			index: asset(manifest, 'NativeDocumentsAcceptanceIndex'),
			Page: NativeDocumentsAcceptance,
			props: {}
		})
	)
	.get('/svelte', () =>
		handleSveltePageRequest<typeof SvelteExample>({
			indexPath: asset(manifest, 'SvelteExampleIndex'),
			pagePath: asset(manifest, 'SvelteExample'),
			props: {
				cssPath: asset(manifest, 'SvelteExampleCSS'),
				initialCount: 0
			}
		})
	)
	.get('/vue', () =>
		handleVuePageRequest<typeof VueExample>({
			headTag: generateHeadElement({
				cssPath: [
					asset(manifest, 'VueExampleCSS'),
					asset(manifest, 'VueExampleCompiledCSS')
				],
				title: 'AbsoluteJS + Vue'
			}),
			indexPath: asset(manifest, 'VueExampleIndex'),
			pagePath: asset(manifest, 'VueExample'),
			props: { initialCount: 0 }
		})
	)
	// SPA shell: one SSR entry serving every child route (the child's compiled
	// CSS is inlined via the page's .spa.json side manifest — see
	// utils/spaRouteCss.ts). `request` is forwarded so the handler can match
	// the URL against the registered child routes.
	.get('/spashell', ({ request }) =>
		handleVuePageRequest<typeof SpaShell>({
			headTag: generateHeadElement({
				cssPath: [
					asset(manifest, 'SpaShellCSS'),
					asset(manifest, 'SpaShellCompiledCSS')
				],
				title: 'AbsoluteJS + Vue SPA'
			}),
			indexPath: asset(manifest, 'SpaShellIndex'),
			pagePath: asset(manifest, 'SpaShell'),
			props: {},
			request
		})
	)
	.get('/spashell/*', ({ request }) =>
		handleVuePageRequest<typeof SpaShell>({
			headTag: generateHeadElement({
				cssPath: [
					asset(manifest, 'SpaShellCSS'),
					asset(manifest, 'SpaShellCompiledCSS')
				],
				title: 'AbsoluteJS + Vue SPA'
			}),
			indexPath: asset(manifest, 'SpaShellIndex'),
			pagePath: asset(manifest, 'SpaShell'),
			props: {},
			request
		})
	)
	.get('/angular', async () =>
		handleAngularPageRequest<AngularExamplePage.Context>({
			headTag: generateHeadElement({
				cssPath: asset(manifest, 'AngularExampleCSS'),
				title: 'AbsoluteJS + Angular'
			}),
			indexPath: asset(manifest, 'AngularExampleIndex'),
			pagePath: asset(manifest, 'AngularExample'),
			requestContext: { initialCount: 0 }
		})
	)
	.get('/ember', () =>
		handleEmberPageRequest({
			headTag: generateHeadElement({
				title: 'AbsoluteJS + Ember'
			}),
			indexPath: '',
			pagePath: asset(manifest, 'EmberExample'),
			props: { initialCount: 0 }
		})
	)
	.get('/htmx', () => handleHTMXPageRequest(asset(manifest, 'HTMXExample')))
	.post('/htmx/reset', ({ resetScopedStore }) => resetScopedStore())
	.get('/htmx/count', ({ scopedStore }) => scopedStore.count)
	.post('/htmx/increment', ({ scopedStore }) => ++scopedStore.count)
	.error(({ error, request }) => {
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	})
	.use(networking);
