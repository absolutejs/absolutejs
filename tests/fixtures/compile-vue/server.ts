import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleVuePageRequest } from '@absolutejs/absolute/vue/server';

const { absolutejs, manifest } = await prepare();
const pageAssets = (key: string) => ({
	indexPath: asset(manifest, `${key}Index`),
	pagePath: asset(manifest, key)
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleVuePageRequest({
			headTag:
				'<head><title>Compile Vue</title><link rel="stylesheet" href="/vue.css"></head>',
			props: {},
			...pageAssets('Home')
		})
	)
	.get('/boom', () =>
		handleVuePageRequest({
			headTag: '<head><title>Compile Vue Boom</title></head>',
			props: {},
			...pageAssets('Boom')
		})
	)
	.get('/api/env', () => ({
		ok: true,
		secret: process.env.COMPILE_VUE_SECRET ?? null
	}))
	.use(networking);
