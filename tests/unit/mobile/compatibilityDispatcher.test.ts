import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAbsoluteMobileCompatibilityDispatcher } from '../../../src/mobile/compatibilityDispatcher';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	MOBILE_PAGE_REQUEST_HEADERS
} from '../../../src/mobile/pageProtocol';
import {
	createAbsoluteMobileCompatibilityArtifact,
	type AbsoluteMobileCompatibilityArtifactInput
} from '../../../src/mobile/releaseArtifact';

const artifactInput = (
	generation: number
): AbsoluteMobileCompatibilityArtifactInput => ({
	appBuild: `build-${generation}`,
	appId: 'com.example.absolute',
	generation,
	pages: [
		{
			bundleHash: `page-${generation}`,
			contract: `account@${generation}`,
			framework: 'react',
			pageId: 'Account',
			propsSchemaHash: `schema-${generation}`
		}
	],
	producer: {
		bundleHash: `producer-${generation}`,
		bytes: generation,
		exportName: 'mobileProducer',
		module: `producers/${generation}.js`
	},
	routes: [{ method: 'GET', pageId: 'Account', pattern: '/account' }],
	runtime: `runtime-${generation}`
});

const mobileRequest = (generation: number) =>
	new Request('https://example.test/account', {
		headers: {
			accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
			[MOBILE_PAGE_REQUEST_HEADERS.appBuild]: `build-${generation}`,
			[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: `page-${generation}`,
			[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: `account@${generation}`,
			[MOBILE_PAGE_REQUEST_HEADERS.pageId]: 'Account',
			[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
			[MOBILE_PAGE_REQUEST_HEADERS.runtime]: `runtime-${generation}`
		}
	});

describe('mobile compatibility dispatcher', () => {
	test('dispatches a retained client to its archived producer', async () => {
		const current = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(3)
		);
		const previous = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(2)
		);
		let loads = 0;
		const dispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: [current, previous],
			currentReleaseId: current.releaseId,
			loadProducer: async (artifact) => {
				loads += 1;

				return {
					handle: () =>
						new Response(`archived:${artifact.generation}`)
				};
			}
		});
		const app = new Elysia()
			.use(dispatcher)
			.get('/account', () => 'current');

		expect(await (await app.handle(mobileRequest(2))).text()).toBe(
			'archived:2'
		);
		expect(await (await app.handle(mobileRequest(2))).text()).toBe(
			'archived:2'
		);
		expect(loads).toBe(1);
	});

	test('lets the current release continue through normal route handling', async () => {
		const current = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(3)
		);
		const dispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: [current],
			currentReleaseId: current.releaseId,
			loadProducer: async () => {
				throw new Error('The current producer must not be loaded.');
			}
		});
		const app = new Elysia()
			.use(dispatcher)
			.get('/account', () => 'current');

		expect(await (await app.handle(mobileRequest(3))).text()).toBe(
			'current'
		);
	});

	test('returns an update envelope after a client leaves retention', async () => {
		const current = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(3)
		);
		const dispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: [current],
			currentReleaseId: current.releaseId,
			loadProducer: async () => {
				throw new Error('An evicted producer must not be loaded.');
			}
		});
		const app = new Elysia()
			.use(dispatcher)
			.get('/account', () => 'current');
		const response = await app.handle(mobileRequest(0));
		const envelope = await response.json();

		expect(response.status).toBe(426);
		expect(envelope.response).toMatchObject({
			kind: 'upgrade-required',
			reason: 'app-release'
		});
	});

	test('does not dispatch a valid page bundle onto an unrelated URL', async () => {
		const current = createAbsoluteMobileCompatibilityArtifact(
			artifactInput(3)
		);
		const dispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: [current],
			currentReleaseId: current.releaseId,
			loadProducer: async () => {
				throw new Error('An unrelated route must not load a producer.');
			}
		});
		const app = new Elysia().use(dispatcher).get('/admin', () => 'admin');
		const request = mobileRequest(3);
		const response = await app.handle(
			new Request('https://example.test/admin', request)
		);
		const envelope = await response.json();

		expect(response.status).toBe(400);
		expect(envelope.response).toMatchObject({ kind: 'invalid-request' });
	});
});
