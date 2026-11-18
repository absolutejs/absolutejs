import { Elysia } from 'elysia';
import { asset, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { SuspenseSlotPage } from './react/pages/SuspenseSlotPage';

const { absolutejs, manifest } = await prepare();

const app = new Elysia()
	.use(absolutejs)
	.get('/hmr-status', () => ({ ok: true }))
	.get('/', async () => {
		const index = asset(manifest, 'SuspenseSlotPageIndex');

		return handleReactPageRequest({
			index,
			Page: SuspenseSlotPage
		});
	});

const port = Number(process.env.PORT ?? 3010);

app.listen(port);

console.log(`react-suspense-slot-client fixture listening on ${port}`);
