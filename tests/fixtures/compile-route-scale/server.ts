import { Elysia, t } from 'elysia';
import { networking, prepare } from '@absolutejs/absolute';
import { scalePageCount } from './runtime/routes';

await prepare();

const renderPage = (title: string, links = '') =>
	new Response(
		`<!DOCTYPE html><html><head><title>${title}</title><link rel="stylesheet" href="/scale.css"></head><body><h1>${title}</h1>${links}</body></html>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8' } }
	);

export const server = new Elysia()
	.get('/', () =>
		renderPage(
			'ROUTE_SCALE_HOME',
			'<a href="/section">Section</a><a href="/page-0">First page</a>'
		)
	)
	.get('/section', () => renderPage('ROUTE_SCALE_SECTION'))
	.get('/section/', () => renderPage('ROUTE_SCALE_SECTION_SLASH'))
	.get('/section/deep', () => renderPage('ROUTE_SCALE_DEEP'))
	.get('/query', ({ query }) =>
		renderPage(`ROUTE_SCALE_QUERY_${query.tab ?? 'missing'}`)
	)
	.get('/redirect-static', () => Response.redirect('/section', 302))
	.get('/redirect-query', ({ query }) =>
		Response.redirect(
			`/runtime/${query.target ?? 'missing'}?mode=${
				query.mode ?? 'redirected'
			}`,
			307
		)
	)
	.get(
		'/asset-like/known.txt',
		() =>
			new Response('ROUTE_SCALE_ASSET_LIKE_READY', {
				headers: { 'content-type': 'text/plain; charset=utf-8' }
			})
	)
	.get('/api/static-json', () => ({ cached: false, ok: true }))
	.head(
		'/api/head-check',
		() =>
			new Response(null, {
				headers: {
					'x-route-scale-head': 'ready'
				}
			})
	)
	.options(
		'/api/options-check',
		() =>
			new Response(null, {
				headers: {
					allow: 'GET, HEAD, OPTIONS',
					'x-route-scale-options': 'ready'
				},
				status: 204
			})
	)
	.get('/runtime/:id', ({ params, query }) => ({
		id: params.id,
		mode: query.mode ?? null,
		ok: true
	}))
	.get('/catch-all/*', ({ params, request }) => ({
		ok: true,
		path: params['*'],
		search: new URL(request.url).search
	}))
	.get(
		'/page-:id',
		({ params }) => {
			const id = Number(params.id);
			if (!Number.isInteger(id) || id < 0 || id >= scalePageCount) {
				return new Response('missing scale page', { status: 404 });
			}

			return renderPage(`ROUTE_SCALE_PAGE_${id}`);
		},
		{ params: t.Object({ id: t.String() }) }
	)
	.use(networking);
