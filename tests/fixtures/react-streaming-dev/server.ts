import { Elysia } from 'elysia';
import { asset, handleReactPageRequest, prepare } from '../../../src/index';
import { StreamingPage } from './react/pages/StreamingPage';

const { absolutejs, manifest } = await prepare();

const app = new Elysia()
	.use(absolutejs)
	.get('/hmr-status', () => ({ ok: true }))
	.get('/', async () =>
		handleReactPageRequest({
			Page: StreamingPage,
			collectStreamingSlots: true,
			index: asset(manifest, 'StreamingPageIndex')
		})
	);

const port = Number(process.env.PORT ?? 3010);

app.listen(port);

console.log(`react-streaming-dev fixture listening on ${port}`);
