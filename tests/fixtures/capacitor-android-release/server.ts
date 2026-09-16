import { Elysia } from 'elysia';
import { asset, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { ReleasePage } from './react/pages/ReleasePage';

const { absolutejs, manifest } = await prepare();

export const app = new Elysia().use(absolutejs).get('/', ({ request }) =>
	handleReactPageRequest({
		index: asset(manifest, 'ReleasePageIndex'),
		Page: ReleasePage,
		props: { message: 'Capacitor Android production release ready' },
		request
	})
);
