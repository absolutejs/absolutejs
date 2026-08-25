import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { getAvailablePort } from '../../helpers/ports';

const PROJECT_ROOT = resolvePath(import.meta.dir, '..', '..', '..');
const FIXTURE = join(PROJECT_ROOT, 'tests', 'fixtures', 'pwa-build');
const CHROMIUM_ARGS = [
	'--no-sandbox',
	'--disable-dev-shm-usage',
	'--disable-gpu'
];

let buildDirectory = '';
let profileDirectory = '';
let context: BrowserContext | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;

type FiniteRequest = {
	account?: string;
	body: unknown;
};

type CollectionAddress = {
	key: string;
	namespace: string;
};

type CollectionInput = CollectionAddress & {
	collection: string;
	value: string;
};

const activeWorkerNamespace = async () => {
	const request = indexedDB.open('absolutejs-pwa-sync-config-v1');
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		return await new Promise<string | undefined>((resolve, reject) => {
			const transaction = database.transaction('config', 'readonly');
			const get = transaction.objectStore('config').get('active');
			get.onsuccess = () => resolve(get.result?.namespace);
			get.onerror = () => reject(get.error);
		});
	} finally {
		database.close();
	}
};

const putCollection = async ({
	namespace,
	key,
	collection,
	value
}: CollectionInput) => {
	const request = indexedDB.open('absolutejs-sync-local-v1');
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(
				'collections',
				'readwrite'
			);
			transaction.objectStore('collections').put({
				collection,
				headlessKey: 'id',
				key,
				namespace,
				rows: [{ id: 'row', value }],
				version: 1
			});
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	} finally {
		database.close();
	}
};

const readCollectionValue = async ({ namespace, key }: CollectionAddress) => {
	const open = indexedDB.open('absolutejs-sync-local-v1');
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	try {
		return await new Promise<string | undefined>((resolve, reject) => {
			const transaction = database.transaction('collections', 'readonly');
			const request = transaction
				.objectStore('collections')
				.get([namespace, key]);
			request.onsuccess = () => resolve(request.result?.rows?.[0]?.value);
			request.onerror = () => reject(request.error);
		});
	} finally {
		database.close();
	}
};

const accountFrom = (request: Request) =>
	request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith('pwa-account='))
		?.slice('pwa-account='.length);

const launch = () =>
	chromium.launchPersistentContext(profileDirectory, {
		args: CHROMIUM_ARGS,
		headless: true,
		viewport: { height: 720, width: 1280 }
	});

const waitForNamespace = (page: Page, namespace?: string) =>
	page.waitForFunction(
		async (expected) => {
			const request = indexedDB.open('absolutejs-pwa-sync-config-v1');
			const database = await new Promise<IDBDatabase>(
				(resolve, reject) => {
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				}
			);
			try {
				const active = await new Promise<unknown>((resolve, reject) => {
					const transaction = database.transaction(
						'config',
						'readonly'
					);
					const get = transaction.objectStore('config').get('active');
					get.onsuccess = () => resolve(get.result);
					get.onerror = () => reject(get.error);
				});

				return (
					(active as { namespace?: string } | undefined)
						?.namespace === expected
				);
			} finally {
				database.close();
			}
		},
		namespace,
		{ timeout: 15_000 }
	);

afterAll(async () => {
	await context?.close().catch(() => undefined);
	server?.stop(true);
	if (buildDirectory)
		await rm(buildDirectory, { force: true, recursive: true });
	if (profileDirectory)
		await rm(profileDirectory, { force: true, recursive: true });
});

describe('PWA runtime conformance', () => {
	test('keeps offline state across restart and isolates account Sync state', async () => {
		buildDirectory = await mkdtemp(join(FIXTURE, '.runtime-build-'));
		profileDirectory = await mkdtemp(
			join(tmpdir(), 'absolute-pwa-profile-')
		);
		const build = Bun.spawn(
			['bun', 'run', join(FIXTURE, 'run.ts'), buildDirectory],
			{
				cwd: FIXTURE,
				env: { ...globalThis.process.env, TELEMETRY_OFF: '1' },
				stderr: 'pipe',
				stdout: 'pipe'
			}
		);
		const [exitCode, stderr] = await Promise.all([
			build.exited,
			new Response(build.stderr).text()
		]);
		expect(stderr).toBe('');
		expect(exitCode).toBe(0);

		const finiteRequests: FiniteRequest[] = [];
		const port = await getAvailablePort();
		server = Bun.serve({
			hostname: '127.0.0.1',
			port,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (url.pathname.startsWith('/session/')) {
					const account = url.pathname.slice('/session/'.length);

					return new Response(null, {
						headers: {
							'set-cookie': `pwa-account=${account}; Path=/; HttpOnly; SameSite=Lax`
						}
					});
				}
				if (url.pathname === '/logout') {
					return new Response(null, {
						headers: {
							'set-cookie':
								'pwa-account=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
						}
					});
				}
				if (url.pathname === '/__absolute/sync/principal') {
					const account = accountFrom(request);

					return account
						? Response.json({
								namespace: `principal-${account}`,
								version: 1
							})
						: Response.json(
								{ error: 'unauthenticated' },
								{ status: 401 }
							);
				}
				if (url.pathname === '/__absolute/sync/background') {
					const body: unknown = await request.json();
					finiteRequests.push({
						account: accountFrom(request),
						body
					});
					const pulls =
						typeof body === 'object' &&
						body !== null &&
						Array.isArray(Reflect.get(body, 'pulls'))
							? Reflect.get(body, 'pulls')
							: [];

					return Response.json({
						mutations: [],
						pulls: pulls.map((pull: { id: string }) => ({
							cursor: 'server-cursor',
							id: pull.id,
							rows: [],
							type: 'snapshot',
							version: 2
						})),
						version: 1
					});
				}

				const decoded = decodeURIComponent(url.pathname);
				const relative =
					decoded === '/' ? '/pages/index.html' : decoded;
				const file = resolvePath(buildDirectory, `.${relative}`);
				if (
					!file.startsWith(`${resolvePath(buildDirectory)}${sep}`) ||
					!existsSync(file)
				)
					return new Response('Not found', { status: 404 });

				return new Response(Bun.file(file));
			}
		});
		const origin = `http://${server.hostname}:${server.port}`;

		context = await launch();
		await context.addCookies([
			{ name: 'pwa-account', url: origin, value: 'a' }
		]);
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(`${origin}/pages/index.html`, { waitUntil: 'load' });
		await page.waitForFunction(
			() => navigator.serviceWorker.controller !== null,
			undefined,
			{ timeout: 15_000 }
		);
		await waitForNamespace(page, 'principal-a');
		await page.waitForFunction(
			() =>
				(
					globalThis as typeof globalThis & {
						__PWA_SYNC_RESULTS__?: unknown[];
					}
				).__PWA_SYNC_RESULTS__?.length,
			undefined,
			{ timeout: 15_000 }
		);

		await page.evaluate(putCollection, {
			collection: 'a-only',
			key: 'account-data',
			namespace: 'principal-a',
			value: 'secret-a'
		});
		expect(
			await page.evaluate(readCollectionValue, {
				key: 'account-data',
				namespace: 'principal-a'
			})
		).toBe('secret-a');
		expect(
			await page.evaluate(readCollectionValue, {
				key: 'account-data',
				namespace: 'principal-b'
			})
		).toBeUndefined();

		await page.evaluate(() => fetch('/session/b', { method: 'POST' }));
		await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
		await waitForNamespace(page, 'principal-b');
		await page.evaluate(putCollection, {
			collection: 'b-only',
			key: 'account-data',
			namespace: 'principal-b',
			value: 'secret-b'
		});
		expect(
			await page.evaluate(readCollectionValue, {
				key: 'account-data',
				namespace: 'principal-b'
			})
		).toBe('secret-b');
		const resultsBeforeLifecycle = await page.evaluate(
			() =>
				(
					globalThis as typeof globalThis & {
						__PWA_SYNC_RESULTS__?: unknown[];
					}
				).__PWA_SYNC_RESULTS__?.length ?? 0
		);
		await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
		await page.waitForFunction(
			(previous) =>
				((
					globalThis as typeof globalThis & {
						__PWA_SYNC_RESULTS__?: unknown[];
					}
				).__PWA_SYNC_RESULTS__?.length ?? 0) > previous,
			resultsBeforeLifecycle,
			{ timeout: 15_000 }
		);
		expect(
			await page.evaluate(readCollectionValue, {
				key: 'account-data',
				namespace: 'principal-a'
			})
		).toBe('secret-a');
		expect(
			await page.evaluate(readCollectionValue, {
				key: 'account-data',
				namespace: 'principal-b'
			})
		).toBeUndefined();
		expect(finiteRequests).toContainEqual({
			account: 'b',
			body: expect.objectContaining({
				pulls: [expect.objectContaining({ collection: 'b-only' })],
				version: 1
			})
		});

		const results = await page.evaluate(
			() =>
				(
					globalThis as typeof globalThis & {
						__PWA_SYNC_RESULTS__: Array<Record<string, unknown>>;
					}
				).__PWA_SYNC_RESULTS__
		);
		expect(results.length).toBeGreaterThan(0);
		for (const result of results) {
			expect(Object.keys(result).sort()).toEqual(
				expect.arrayContaining(['durationMs', 'ok', 'trigger'])
			);
			expect(Object.keys(result)).not.toContain('namespace');
			expect(Object.keys(result)).not.toContain('endpoint');
			expect(Object.keys(result)).not.toContain('token');
		}

		await page.evaluate(() => fetch('/logout', { method: 'POST' }));
		await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
		await waitForNamespace(page, undefined);
		expect(await page.evaluate(activeWorkerNamespace)).toBeUndefined();

		await context.close();
		context = undefined;
		context = await launch();
		await context.setOffline(true);
		server.stop(true);
		server = undefined;
		const restarted = context.pages()[0] ?? (await context.newPage());
		await restarted.goto(`${origin}/not-cached-after-restart`, {
			waitUntil: 'domcontentloaded'
		});
		expect(await restarted.locator('body').textContent()).toContain(
			'You are offline.'
		);
	}, 90_000);
});
