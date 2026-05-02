import { Elysia } from '__ELYSIA_ENTRY__';
import { asset, networking, prepare } from '__ABSOLUTE_DIST_INDEX__';
import { handleReactPageRequest } from '__ABSOLUTE_DIST_REACT__';
import { BoomPage } from './react/pages/boom';
import { GoodPage } from './react/pages/good';
import { LinkedPage } from './react/pages/linked';

const { absolutejs, manifest } = await prepare();
const moduleLoadSecret = process.env.COMPILE_RUNTIME_SECRET ?? 'missing';
let runtimeCounter = 0;

export const server = new Elysia()
	.use(absolutejs)
	.get('/', () =>
		handleReactPageRequest({
			Page: GoodPage,
			index: asset(manifest, 'GoodIndex')
		})
	)
	.get('/linked', () =>
		handleReactPageRequest({
			Page: LinkedPage,
			index: asset(manifest, 'LinkedIndex')
		})
	)
	.get('/boom', () =>
		handleReactPageRequest({
			Page: BoomPage,
			index: asset(manifest, 'BoomIndex')
		})
	)
	.get('/api/ping', ({ query }) => ({
		message: query.message ?? 'runtime',
		ok: true
	}))
	.get('/api/env', () => ({
		moduleLoadSecret,
		ok: true,
		requestSecret: process.env.COMPILE_RUNTIME_SECRET ?? null
	}))
	.get('/api/state', () => {
		runtimeCounter += 1;

		return { count: runtimeCounter, ok: true };
	})
	.post('/api/json', async ({ request }) => {
		const body = (await request.json()) as { value?: string };
		const url = new URL(request.url);

		return {
			ok: true,
			query: url.searchParams.get('mode'),
			value: body.value ?? null
		};
	})
	.post('/api/form', async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');

		return {
			fileName: file instanceof File ? file.name : null,
			fileText: file instanceof File ? await file.text() : null,
			ok: true,
			value: form.get('value')
		};
	})
	.post('/api/clone', async ({ request }) => {
		const cloned = request.clone();

		return {
			clone: await cloned.text(),
			ok: true,
			original: await request.text()
		};
	})
	.get('/api/headers-cookies', ({ request }) => {
		const cookie = request.headers.get('cookie') ?? '';

		return {
			cookie,
			ok: true,
			probe: request.headers.get('x-compile-probe')
		};
	})
	.get('/api/blob', async () => {
		const blob = new Blob(['BLOB_', 'READY'], { type: 'text/plain' });

		return {
			ok: true,
			size: blob.size,
			text: await blob.text(),
			type: blob.type
		};
	})
	.post('/api/array-buffer', async ({ request }) => {
		const bytes = new Uint8Array(await request.arrayBuffer());

		return {
			bytes: Array.from(bytes),
			ok: true,
			size: bytes.byteLength
		};
	})
	.get(
		'/api/binary',
		() =>
			new Response(new Uint8Array([0, 1, 2, 253, 254, 255]), {
				headers: {
					'cache-control': 'no-store',
					'content-type': 'application/octet-stream',
					'x-binary-probe': 'ready'
				}
			})
	)
	.get(
		'/api/set-cookie',
		() =>
			new Response(JSON.stringify({ ok: true }), {
				headers: {
					'content-type': 'application/json',
					'set-cookie':
						'compile-session=ready; Path=/; HttpOnly; SameSite=Lax'
				}
			})
	)
	.put('/api/method/:id', async ({ params, request }) => ({
		body: await request.text(),
		id: params.id,
		method: request.method,
		ok: true
	}))
	.delete('/api/method/:id', ({ params, request }) => ({
		id: params.id,
		method: request.method,
		ok: true
	}))
	.get('/api/query-repeat', ({ request }) => {
		const url = new URL(request.url);

		return {
			ok: true,
			values: url.searchParams.getAll('tag')
		};
	})
	.get(
		'/stream',
		() =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue('STREAM_');
						controller.enqueue('READY');
						controller.close();
					}
				}),
				{ headers: { 'content-type': 'text/plain; charset=utf-8' } }
			)
	)
	.get(
		'/stream-error',
		() =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue('STREAM_BEFORE_ERROR');
						controller.error(new Error('STREAM_RUNTIME_FAILURE'));
					}
				}),
				{ headers: { 'content-type': 'text/plain; charset=utf-8' } }
			)
	)
	.get(
		'/browser',
		() =>
			new Response(
				`<!DOCTYPE html>
				<html>
					<head>
						<title>Browser probe</title>
						<link rel="stylesheet" href="/stress.css" />
					</head>
					<body>
						<h1>BROWSER_READY</h1>
						<p class="status">STYLE_READY</p>
						<button id="increment">Count 0</button>
						<p id="dynamic-feature">DYNAMIC_PENDING</p>
						<p id="worker-feature">WORKER_PENDING</p>
						<a href="/linked">Linked page</a>
						<script type="module" src="/browser.js"></script>
					</body>
				</html>`,
				{ headers: { 'content-type': 'text/html; charset=utf-8' } }
			)
	)
	.post('/api/echo', async ({ request }) => ({
		body: await request.text(),
		ok: true
	}))
	.get('/header', ({ headers }) => ({
		probe: headers['x-compile-probe'] ?? null
	}))
	.get('/redirect-me', () => Response.redirect('/linked', 302))
	.use(networking);
