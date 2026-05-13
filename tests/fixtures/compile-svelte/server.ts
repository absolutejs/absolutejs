import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleSveltePageRequest } from '@absolutejs/absolute/svelte/server';

const { absolutejs, manifest } = await prepare();
const pageAssets = (key: string) => ({
	indexPath: asset(manifest, `${key}Index`),
	pagePath: asset(manifest, key)
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleSveltePageRequest({
			headContent:
				'<title>Compile Svelte</title><link rel="stylesheet" href="/svelte.css">',
			...pageAssets('Home')
		})
	)
	.get('/boom', () =>
		handleSveltePageRequest({
			headContent: '<title>Compile Svelte Boom</title>',
			...pageAssets('Boom')
		})
	)
	.get('/api/env', () => ({
		ok: true,
		secret: process.env.COMPILE_SVELTE_SECRET ?? null
	}))
	.use(networking);
