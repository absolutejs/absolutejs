import { Elysia } from '__ELYSIA_ENTRY__';
import { asset, networking, prepare } from '__ABSOLUTE_DIST_INDEX__';
import { handleVuePageRequest } from '__ABSOLUTE_DIST_VUE__';

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
			...pageAssets('Home')
		})
	)
	.get('/boom', () =>
		handleVuePageRequest({
			headTag: '<head><title>Compile Vue Boom</title></head>',
			...pageAssets('Boom')
		})
	)
	.get('/api/env', () => ({
		ok: true,
		secret: process.env.COMPILE_VUE_SECRET ?? null
	}))
	.use(networking);
