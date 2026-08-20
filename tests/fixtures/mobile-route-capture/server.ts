import { Elysia } from 'elysia';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { Account } from './react/pages/Account';

const manifest: Record<string, string> = {
	AccountIndex: '/account-client.js'
};

const asset = (assets: Record<string, string>, key: string) => {
	const value = assets[key];
	if (!value) throw new TypeError(`Missing asset ${key}.`);

	return value;
};

const pages = new Elysia({ prefix: '/v1' })
	.get('/account/:id', ({ params, request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'AccountIndex'),
			Page: Account,
			props: { displayName: params.id },
			request
		})
	)
	.get('/profile/:id', ({ params, request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'AccountIndex'),
			Page: Account,
			props: { displayName: params.id },
			request
		})
	);

export const app = new Elysia().use(pages);
