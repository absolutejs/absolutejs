import { Elysia } from 'elysia';
import { asset, prepare } from '../../../src/index';
import { handleReactPageRequest } from '../../../src/react';
import { StreamingPage } from './react/pages/StreamingPage';

const { absolutejs, manifest } = await prepare();

const app = new Elysia()
	.use(absolutejs)
	.get('/hmr-status', () => ({ ok: true }))
	.get('/', async () => {
		const index = asset(manifest, 'StreamingPageIndex');

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index,
			Page: StreamingPage
		});
	});

const port = Number(process.env.PORT ?? 3010);

app.listen(port);

console.log(`react-streaming-dev fixture listening on ${port}`);
