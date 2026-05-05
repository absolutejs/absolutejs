import { Elysia } from 'elysia';
import type * as BenchPage from './angular/pages/bench';
import {
	asset,
	generateHeadElement,
	prepare
} from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular/server';
import { networking } from '@absolutejs/absolute';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(absolutejs)
	.get('/', async () =>
		handleAngularPageRequest<typeof BenchPage>({
			headTag: generateHeadElement({
				cssPath: asset(manifest, 'BenchCSS'),
				title: 'AbsoluteJS HMR Bench'
			}),
			indexPath: asset(manifest, 'BenchIndex'),
			pagePath: asset(manifest, 'Bench'),
			props: { initialCount: 0 }
		})
	)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	})
	.use(networking);
