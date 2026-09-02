import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Elysia } from 'elysia';
import { buildAbsoluteMobileCompatibilityRelease } from '../../../src/mobile/buildRelease';
import { createAbsoluteMobileCompatibilityDispatcher } from '../../../src/mobile/compatibilityDispatcher';
import {
	ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
	MOBILE_PAGE_REQUEST_HEADERS
} from '../../../src/mobile/pageProtocol';
import { retainAbsoluteMobileCompatibilityArtifacts } from '../../../src/mobile/releaseArtifact';
import { createAbsoluteMobileRouteMetadataPlugin } from '../../../src/mobile/routeMetadataTransform';

const temporaryDirectories: string[] = [];
const fixture = resolve('tests/fixtures/mobile-route-capture/server.ts');
const sourceRoot = resolve('src');
const COMPILER_TEST_TIMEOUT_MS = 60_000;

const frameworks = [
	'angular',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
] as const;

type BuiltGeneration = Awaited<
	ReturnType<typeof buildAbsoluteMobileCompatibilityRelease>
> & {
	app: Elysia;
};

const generationSource = (generation: number) => {
	const marker = `generation${generation}`;
	const importPath = (path: string) =>
		JSON.stringify(join(sourceRoot, path).replaceAll('\\', '/'));

	return `
import { Elysia } from 'elysia';
import { handleAngularPageRequest } from ${importPath('angular/pageHandler')};
import { handleReactPageRequest } from ${importPath('react/pageHandler')};
import { handleSveltePageRequest } from ${importPath('svelte/pageHandler')};
import { handleVuePageRequest } from ${importPath('vue/pageHandler')};
import { handleHTMLPageRequest, handleHTMXPageRequest } from ${importPath('core/pageHandlers')};
import { absoluteRequestContext } from ${importPath('core/requestContext')};

const manifest: Record<string, string> = {
	AccountIndex: '/account-client.js',
	AngularAccount: '/angular-account-server.js',
	AngularAccountIndex: '/angular-account-client.js',
	HTMLAccount: '/html-account.html',
	HTMXAccount: '/htmx-account.html',
	SvelteAccount: '/svelte-account-server.js',
	SvelteAccountIndex: '/svelte-account-client.js',
	VueAccount: '/vue-account-server.js',
	VueAccountIndex: '/vue-account-client.js'
};
const asset = (assets: Record<string, string>, key: string) => assets[key]!;
const pageAssets = (key: string) => ({
	indexPath: asset(manifest, \`\${key}Index\`),
	pagePath: asset(manifest, key)
});
type AccountProps = { displayName: string; revision: number; ${marker}: string };
export const Account = (_props: AccountProps) => null;
const props = (id: string): AccountProps => ({
	displayName: \`generation-${generation}:\${id}\`,
	revision: ${generation},
	${marker}: '${marker}'
});

const pages = new Elysia({ prefix: '/v1' })
	.get('/react/:id', ({ params, request }) => handleReactPageRequest({
		index: asset(manifest, 'AccountIndex'), Page: Account,
		props: props(params.id), request
	}))
	.get('/angular/:id', ({ params, request }) => handleAngularPageRequest({
		...pageAssets('AngularAccount'), request,
		requestContext: props(params.id)
	}))
	.get('/svelte/:id', ({ params, request }) => handleSveltePageRequest({
		...pageAssets('SvelteAccount'), props: props(params.id), request
	}))
	.get('/vue/:id', ({ params, request }) => handleVuePageRequest({
		...pageAssets('VueAccount'), props: props(params.id), request
	}))
	.get('/html/:id', () => handleHTMLPageRequest(asset(manifest, 'HTMLAccount')))
	.get('/htmx/:id', () => handleHTMXPageRequest(asset(manifest, 'HTMXAccount')));

export const app = new Elysia().use(absoluteRequestContext).use(pages);
`;
};

const buildGeneration = async (
	project: string,
	generation: number,
	previous: readonly BuiltGeneration[]
) => {
	const entry = join(project, 'server.ts');
	const output = join(project, `generation-${generation}`);
	await writeFile(entry, generationSource(generation));
	const build = await Bun.build({
		entrypoints: [entry],
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
			createAbsoluteMobileRouteMetadataPlugin({
				entry,
				projectRoot: project
			})
		],
		target: 'bun'
	});
	expect(build.success).toBe(true);
	const clientAssets: Record<string, string> = {
		AccountIndex: join(output, 'account-client.js'),
		AngularAccountIndex: join(output, 'angular-account-client.js'),
		HTMLAccount: join(output, 'html-account.html'),
		HTMXAccount: join(output, 'htmx-account.html'),
		SvelteAccountIndex: join(output, 'svelte-account-client.js'),
		VueAccountIndex: join(output, 'vue-account-client.js')
	};
	await Promise.all(
		Object.entries(clientAssets).map(([key, path]) =>
			writeFile(path, `${key}:generation-${generation}`)
		)
	);
	const producerPath = join(output, 'server.js');
	const loaded: { app: Elysia } = await import(
		`${pathToFileURL(producerPath).href}?generation=${generation}`
	);
	const release = await buildAbsoluteMobileCompatibilityRelease({
		app: loaded.app,
		appId: 'com.absolute.generations',
		buildDirectory: output,
		manifest: clientAssets,
		previousArtifacts: previous.map(({ artifact }) => artifact),
		producerExport: 'app',
		producerPath,
		runtime: '1'
	});

	return { ...release, app: loaded.app };
};

const requestFor = (
	release: BuiltGeneration,
	framework: (typeof frameworks)[number]
) => {
	const page = release.artifact.pages.find(
		(candidate) => candidate.framework === framework
	);
	if (!page) throw new Error(`Missing ${framework} page.`);

	return new Request(`https://example.test/v1/${framework}/Ada`, {
		headers: {
			accept: ABSOLUTE_MOBILE_PAGE_MEDIA_TYPE,
			[MOBILE_PAGE_REQUEST_HEADERS.appBuild]: release.artifact.appBuild,
			[MOBILE_PAGE_REQUEST_HEADERS.pageBundle]: page.bundleHash,
			[MOBILE_PAGE_REQUEST_HEADERS.pageContracts]: page.contract,
			[MOBILE_PAGE_REQUEST_HEADERS.pageId]: page.pageId,
			[MOBILE_PAGE_REQUEST_HEADERS.protocol]: '1',
			[MOBILE_PAGE_REQUEST_HEADERS.runtime]: '1'
		}
	});
};

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

	test('keeps every supported framework compatible through N+2 and fails closed at N+3', async () => {
		const project = await mkdtemp(
			join(resolve('.'), '.absolute-mobile-generations-')
		);
		temporaryDirectories.push(project);
		const releases: BuiltGeneration[] = [];
		for (let generation = 1; generation <= 4; generation += 1) {
			releases.push(await buildGeneration(project, generation, releases));
		}
		const [generationOne, generationTwo, generationThree, generationFour] =
			releases;
		if (
			!generationOne ||
			!generationTwo ||
			!generationThree ||
			!generationFour
		)
			throw new Error('Expected four compatibility generations.');

		expect(releases.map(({ artifact }) => artifact.generation)).toEqual([
			1, 2, 3, 4
		]);
		for (const framework of [
			'angular',
			'react',
			'svelte',
			'vue'
		] as const) {
			expect(
				new Set(
					releases.map(
						(release) =>
							release.artifact.pages.find(
								(page) => page.framework === framework
							)?.contract
					)
				)
			).toHaveLength(4);
		}
		for (const framework of ['html', 'htmx'] as const) {
			expect(
				new Set(
					releases.map(
						(release) =>
							release.artifact.pages.find(
								(page) => page.framework === framework
							)?.bundleHash
					)
				)
			).toHaveLength(4);
		}

		const retainedArtifacts = retainAbsoluteMobileCompatibilityArtifacts(
			releases.map(({ artifact }) => artifact)
		);
		expect(retainedArtifacts.map(({ generation }) => generation)).toEqual([
			4, 3, 2
		]);
		const byReleaseId = new Map(
			releases.map((release) => [release.artifact.releaseId, release])
		);
		let archivedLoads = 0;
		const dispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: retainedArtifacts,
			currentReleaseId: generationFour.artifact.releaseId,
			loadProducer: async (artifact) => {
				archivedLoads += 1;
				const release = byReleaseId.get(artifact.releaseId);
				if (!release) throw new Error('Missing archived producer.');

				return release.app;
			}
		});
		const server = new Elysia().use(dispatcher).use(generationFour.app);
		for (const release of [
			generationFour,
			generationThree,
			generationTwo
		]) {
			for (const framework of frameworks) {
				const response = await server.handle(
					requestFor(release, framework)
				);
				expect(response.status).toBe(200);
				const envelope = await response.json();
				expect(envelope.response).toMatchObject({
					framework,
					kind: 'page'
				});
				if (framework === 'html' || framework === 'htmx') {
					expect(envelope.response.props).toEqual({});
				} else {
					expect(envelope.response.props).toMatchObject({
						displayName: `generation-${release.artifact.generation}:Ada`,
						revision: release.artifact.generation,
						[`generation${release.artifact.generation}`]: `generation${release.artifact.generation}`
					});
				}
			}
		}
		expect(archivedLoads).toBe(2);

		for (const framework of frameworks) {
			const response = await server.handle(
				requestFor(generationOne, framework)
			);
			expect(response.status).toBe(426);
			expect(await response.json()).toMatchObject({
				response: { kind: 'upgrade-required', reason: 'app-release' }
			});
		}

		const rollbackDispatcher = createAbsoluteMobileCompatibilityDispatcher({
			artifacts: retainedArtifacts,
			currentReleaseId: generationThree.artifact.releaseId,
			loadProducer: async (artifact) => {
				const release = byReleaseId.get(artifact.releaseId);
				if (!release) throw new Error('Missing rollback producer.');

				return release.app;
			}
		});
		const rollbackServer = new Elysia()
			.use(rollbackDispatcher)
			.use(generationThree.app);
		for (const framework of frameworks) {
			const response = await rollbackServer.handle(
				requestFor(generationFour, framework)
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				response: {
					framework,
					kind: 'page',
					...(framework === 'html' || framework === 'htmx'
						? { props: {} }
						: {
								props: {
									displayName: 'generation-4:Ada',
									revision: 4
								}
							})
				}
			});
		}
	}, 120_000);
});
