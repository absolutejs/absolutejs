import { Elysia } from 'elysia';
import { asset, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { ReleasePage } from './react/pages/ReleasePage';
import { createReleaseProofBackend } from '../../helpers/releaseProofBackend';

const { absolutejs, manifest } = await prepare();
const proof =
	process.env.ABSOLUTE_TEST_RELEASE_CHALLENGE &&
	process.env.ABSOLUTE_TEST_RELEASE_ORIGIN
		? {
				challenge: process.env.ABSOLUTE_TEST_RELEASE_CHALLENGE,
				origin: process.env.ABSOLUTE_TEST_RELEASE_ORIGIN
			}
		: undefined;

export const app = new Elysia()
	.use(absolutejs)
	.use(proof ? createReleaseProofBackend(proof) : new Elysia())
	.get('/', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'ReleasePageIndex'),
			Page: ReleasePage,
			props: { message: 'Expo Android production release ready', proof },
			request
		})
	);
