import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Elysia } from 'elysia';
import { buildAbsoluteMobileCompatibilityRelease } from '../../../src/mobile/buildRelease';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	MOBILE_PAGE_REQUEST_HEADERS
} from '../../../src/mobile/pageProtocol';
import { createAbsoluteMobileRouteMetadataPlugin } from '../../../src/mobile/routeMetadataTransform';

const temporaryDirectories: string[] = [];
const fixture = resolve('tests/fixtures/mobile-route-capture/server.ts');
const COMPILER_TEST_TIMEOUT_MS = 60_000;

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true }))
	);
});

describe('automatic mobile compatibility release build', () => {
	test(
		'uses the finalized Elysia route and generated React contract',
		async () => {
			const output = await mkdtemp(
				join(tmpdir(), 'absolute-mobile-release-')
			);
			temporaryDirectories.push(output);
			const build = await Bun.build({
				entrypoints: [fixture],
				external: ['react', 'react-dom/*'],
				outdir: output,
				plugins: [
					createAbsoluteMobileRouteMetadataPlugin({ entry: fixture })
				],
				target: 'bun'
			});
			expect(build.success).toBe(true);
			const producerPath = join(output, 'server.js');
			const loaded: { app: Elysia } = await import(
				`${pathToFileURL(producerPath).href}?test=${crypto.randomUUID()}`
			);
			const clientPath = join(output, 'account-client.js');
			await writeFile(clientPath, 'export const generation = 1;');
			const release = await buildAbsoluteMobileCompatibilityRelease({
				app: loaded.app,
				appId: 'com.absolute.fixture',
				buildDirectory: output,
				manifest: { AccountIndex: clientPath },
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			const [page] = release.artifact.pages;
			if (!page) throw new Error('Expected a captured mobile page.');
			const request = new Request('https://example.test/v1/account/Ada', {
				headers: {
					accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
					[MOBILE_PAGE_REQUEST_HEADERS.appBuild]:
						release.artifact.appBuild,
					[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: page.bundleHash,
					[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: page.contract,
					[MOBILE_PAGE_REQUEST_HEADERS.pageId]: page.pageId,
					[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
					[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
				}
			});
			const response = await loaded.app.handle(request);
			const envelope = await response.json();
			expect(envelope.response).toMatchObject({
				contract: page.contract,
				kind: 'page',
				pageId: page.pageId,
				props: { displayName: 'Ada', url: '/v1/account/Ada' }
			});
			const unchanged = await buildAbsoluteMobileCompatibilityRelease({
				app: loaded.app,
				appId: 'com.absolute.fixture',
				buildDirectory: output,
				manifest: { AccountIndex: clientPath },
				previousArtifacts: [release.artifact],
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			expect(unchanged.artifact).toEqual(release.artifact);
			await writeFile(clientPath, 'export const generation = 2;');
			const next = await buildAbsoluteMobileCompatibilityRelease({
				app: loaded.app,
				appId: 'com.absolute.fixture',
				buildDirectory: output,
				manifest: { AccountIndex: clientPath },
				previousArtifacts: [release.artifact],
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			expect(next.artifact.generation).toBe(2);
			expect(next.artifact.appBuild).not.toBe(release.artifact.appBuild);
			expect(release.artifact.routes).toEqual([
				{
					method: 'GET',
					pageId: page.pageId,
					pattern: '/v1/account/:id'
				},
				{
					method: 'GET',
					pageId: page.pageId,
					pattern: '/v1/profile/:id'
				}
			]);
			expect(page).toMatchObject({
				contract: expect.stringContaining('react:'),
				framework: 'react',
				pageId: 'tests/fixtures/mobile-route-capture/react/pages/Account.tsx#Account'
			});
		},
		COMPILER_TEST_TIMEOUT_MS
	);
});
