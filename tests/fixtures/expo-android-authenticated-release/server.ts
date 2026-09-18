import { Elysia } from 'elysia';
import { asset, prepare } from '@absolutejs/absolute';
import { handleReactPageRequest } from '@absolutejs/absolute/react';
import { createAuthenticatedReleaseProofBackend } from '../../helpers/authenticatedReleaseProofBackend';
import { ReleasePage } from './react/pages/ReleasePage';
import type { ReleaseProofProps } from '../../helpers/ReleaseDataProof';

const { absolutejs, manifest } = await prepare();
const proof: ReleaseProofProps = {
	challenge:
		process.env.ABSOLUTE_TEST_RELEASE_CHALLENGE ?? 'build-placeholder',
	origin:
		process.env.ABSOLUTE_TEST_RELEASE_ORIGIN ?? 'https://localhost:48443'
};
const backend = await createAuthenticatedReleaseProofBackend({
	...proof,
	appId: 'com.absolutejs.expoauthproof',
	database: process.env.ABSOLUTE_TEST_RELEASE_DATABASE
});
export const app = new Elysia()
	.use(absolutejs)
	.use(backend.app)
	.get('/', ({ request }) =>
		handleReactPageRequest({
			index: asset(manifest, 'ReleasePageIndex'),
			Page: ReleasePage,
			props: proof,
			request
		})
	);
