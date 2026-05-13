import { Elysia } from 'elysia';
import { asset, networking, prepare } from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular/server';

const { absolutejs, manifest } = await prepare();
const pageAssets = (key: string) => ({
	indexPath: asset(manifest, `${key}Index`),
	pagePath: asset(manifest, key)
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', ({ request }) =>
		handleAngularPageRequest({
			headTag:
				'<head><title>Compile Angular</title><link rel="stylesheet" href="/angular.css"></head>',
			request,
			...pageAssets('Home')
		})
	)
	.get('/boom', ({ request }) =>
		handleAngularPageRequest({
			headTag: '<head><title>Compile Angular Boom</title></head>',
			request,
			...pageAssets('Boom')
		})
	)
	.get('/api/env', () => ({
		ok: true,
		secret: process.env.COMPILE_ANGULAR_SECRET ?? null
	}))
	.use(networking);
