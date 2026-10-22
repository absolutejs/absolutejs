import { Elysia } from 'elysia';
import type { Context } from './angular/pages/bench';
import {
	asset,
	generateHeadElement,
	networking,
	prepare
} from '@absolutejs/absolute';
import { handleAngularPageRequest } from '@absolutejs/absolute/angular/server';

const { absolutejs, manifest } = await prepare();

/* `error` here is a union: a thrown Error, or a status response that
 * carries no message. Narrow rather than assume, so the log never prints
 * `undefined` for the half of the union that has nothing to say. */
const logServerError = ({
	error,
	request
}: {
	error: unknown;
	request: Request;
}) => {
	const detail =
		error instanceof Error
			? error.message
			: `non-error response: ${JSON.stringify(error)}`;
	console.error(
		`Server error on ${request.method} ${request.url}: ${detail}`
	);
};

export const server = new Elysia()
	.use(absolutejs)
	.get('/', async () =>
		handleAngularPageRequest<Context>({
			headTag: generateHeadElement({
				cssPath: asset(manifest, 'BenchCSS'),
				title: 'AbsoluteJS HMR Bench'
			}),
			indexPath: asset(manifest, 'BenchIndex'),
			pagePath: asset(manifest, 'Bench'),
			requestContext: { initialCount: 0 }
		})
	)
	.onError(logServerError)
	.use(networking);
