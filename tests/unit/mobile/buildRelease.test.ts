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
		'uses the finalized Elysia route and generated framework contracts',
		async () => {
			const output = await mkdtemp(
				join(tmpdir(), 'absolute-mobile-release-')
			);
			temporaryDirectories.push(output);
			const build = await Bun.build({
				entrypoints: [fixture],
				external: [
					'@angular/*',
					'@vue/*',
					'react',
					'react-dom/*',
					'rxjs',
					'rxjs/*',
					'svelte',
					'svelte/*',
					'vue',
					'vue/*',
					'zone.js'
				],
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
			const clientPaths: {
				AccountIndex: string;
				AngularAccountIndex: string;
				HTMLAccount: string;
				HTMXAccount: string;
				SvelteAccountIndex: string;
				VueAccountIndex: string;
			} = {
				AccountIndex: join(output, 'account-client.js'),
				AngularAccountIndex: join(output, 'angular-account-client.js'),
				HTMLAccount: join(output, 'html-account.html'),
				HTMXAccount: join(output, 'htmx-account.html'),
				SvelteAccountIndex: join(output, 'svelte-account-client.js'),
				VueAccountIndex: join(output, 'vue-account-client.js')
			};
			const vueStylePath = join(output, 'vue-account.css');
			const releaseManifest: Record<string, string> = {
				...clientPaths,
				VueAccountBundledCSS: vueStylePath
			};
			await Promise.all(
				Object.values(clientPaths).map((path) =>
					writeFile(path, 'export const generation = 1;')
				)
			);
			await writeFile(vueStylePath, '.vue-account{color:green}');
			const release = await buildAbsoluteMobileCompatibilityRelease({
				app: loaded.app,
				appId: 'com.absolute.fixture',
				buildDirectory: output,
				manifest: releaseManifest,
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			const page = release.artifact.pages.find(
				({ framework }) => framework === 'react'
			);
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
				manifest: releaseManifest,
				previousArtifacts: [release.artifact],
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			expect(unchanged.artifact).toEqual(release.artifact);
			await writeFile(
				clientPaths.AccountIndex,
				'export const generation = 2;'
			);
			const next = await buildAbsoluteMobileCompatibilityRelease({
				app: loaded.app,
				appId: 'com.absolute.fixture',
				buildDirectory: output,
				manifest: releaseManifest,
				previousArtifacts: [release.artifact],
				producerExport: 'app',
				producerPath,
				runtime: '1'
			});
			expect(next.artifact.generation).toBe(2);
			expect(next.artifact.appBuild).not.toBe(release.artifact.appBuild);
			expect(
				release.artifact.pages.map(({ framework }) => framework).sort()
			).toEqual(['angular', 'html', 'htmx', 'react', 'svelte', 'vue']);
			expect(
				release.artifact.routes.map(({ pattern }) => pattern).sort()
			).toEqual([
				'/v1/account/:id',
				'/v1/angular/:id',
				'/v1/html/:id',
				'/v1/htmx/:id',
				'/v1/profile/:id',
				'/v1/svelte/:id',
				'/v1/vue/:id'
			]);
			expect(page).toMatchObject({
				contract: expect.stringContaining('react:'),
				framework: 'react',
				pageId: 'tests/fixtures/mobile-route-capture/react/pages/Account.tsx#Account'
			});
			for (const framework of ['angular', 'svelte', 'vue'] as const) {
				const frameworkPage = release.artifact.pages.find(
					(candidate) => candidate.framework === framework
				);
				if (!frameworkPage) {
					throw new Error(`Expected a captured ${framework} page.`);
				}
				if (framework === 'vue') {
					expect(frameworkPage.styleBundlePath).toBe(
						'/vue-account.css'
					);
					expect(frameworkPage.styleBundleHash).toHaveLength(64);
				}
				const frameworkResponse = await loaded.app.handle(
					new Request(`https://example.test/v1/${framework}/Ada`, {
						headers: {
							accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
							[MOBILE_PAGE_REQUEST_HEADERS.appBuild]:
								release.artifact.appBuild,
							[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]:
								frameworkPage.bundleHash,
							[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]:
								frameworkPage.contract,
							[MOBILE_PAGE_REQUEST_HEADERS.pageId]:
								frameworkPage.pageId,
							[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
							[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
						}
					})
				);
				const frameworkEnvelope = await frameworkResponse.json();
				expect(frameworkEnvelope.response).toMatchObject({
					contract: frameworkPage.contract,
					framework,
					kind: 'page',
					pageId: frameworkPage.pageId,
					props: {
						...(framework === 'svelte'
							? {}
							: { displayName: 'Ada' }),
						...(framework === 'svelte'
							? { url: `/v1/${framework}/Ada` }
							: {})
					}
				});
			}
			for (const framework of ['html', 'htmx'] as const) {
				const staticPage = release.artifact.pages.find(
					(candidate) => candidate.framework === framework
				);
				if (!staticPage) {
					throw new Error(`Expected a captured ${framework} page.`);
				}
				const staticResponse = await loaded.app.handle(
					new Request(`https://example.test/v1/${framework}/Ada`, {
						headers: {
							accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
							[MOBILE_PAGE_REQUEST_HEADERS.appBuild]:
								release.artifact.appBuild,
							[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]:
								staticPage.bundleHash,
							[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]:
								staticPage.contract,
							[MOBILE_PAGE_REQUEST_HEADERS.pageId]:
								staticPage.pageId,
							[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
							[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
						}
					})
				);
				expect(await staticResponse.json()).toMatchObject({
					response: {
						framework,
						kind: 'page',
						pageId: staticPage.pageId,
						props: {}
					}
				});
			}
		},
		COMPILER_TEST_TIMEOUT_MS
	);
});
