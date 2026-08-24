import { Elysia } from 'elysia';
import { handleAngularPageRequest } from '../../../src/angular/pageHandler';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { handleSveltePageRequest } from '../../../src/svelte/pageHandler';
import { handleVuePageRequest } from '../../../src/vue/pageHandler';
import { Account } from './react/pages/Account';

const manifest: Record<string, string> = {
	AccountIndex: '/account-client.js',
	AngularAccount: '/angular-account-server.js',
	AngularAccountIndex: '/angular-account-client.js',
	SvelteAccount: '/svelte-account-server.js',
	SvelteAccountIndex: '/svelte-account-client.js',
	VueAccount: '/vue-account-server.js',
	VueAccountIndex: '/vue-account-client.js'
};

const asset = (assets: Record<string, string>, key: string) => {
	const value = assets[key];
	if (!value) throw new TypeError(`Missing asset ${key}.`);

	return value;
};

const pageAssets = (key: string) => ({
	indexPath: asset(manifest, `${key}Index`),
	pagePath: asset(manifest, key)
});

const pages = new Elysia({ prefix: '/v1' })
	.get('/account/:id', ({ params, request }) => {
		const index = asset(manifest, 'AccountIndex');

		return handleReactPageRequest({
			index,
			Page: Account,
			props: { displayName: params.id },
			request
		});
	})
	.get('/profile/:id', ({ params, request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'AccountIndex'),
			Page: Account,
			props: { displayName: params.id },
			request
		})
	)
	.get('/angular/:id', ({ params, request }) =>
		handleAngularPageRequest({
			indexPath: asset(manifest, 'AngularAccountIndex'),
			pagePath: asset(manifest, 'AngularAccount'),
			request,
			requestContext: { displayName: params.id }
		})
	)
	.get('/svelte/:id', ({ request }) =>
		handleSveltePageRequest({
			indexPath: asset(manifest, 'SvelteAccountIndex'),
			pagePath: asset(manifest, 'SvelteAccount'),
			request
		})
	)
	.get('/vue/:id', ({ params, request }) =>
		handleVuePageRequest({
			props: { displayName: params.id },
			request,
			...pageAssets('VueAccount')
		})
	);

export const app = new Elysia().use(pages);
