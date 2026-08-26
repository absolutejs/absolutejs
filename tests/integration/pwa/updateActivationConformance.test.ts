import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const versionedWorker = (source: string, version: string) => `${source}
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'ABSOLUTE_TEST_WORKER_VERSION') {
    event.source && event.source.postMessage({
      type: 'ABSOLUTE_TEST_WORKER_VERSION',
      version: ${JSON.stringify(version)}
    });
  }
});
`;

const controllerVersion = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<string>((resolve, reject) => {
				const timeout = globalThis.setTimeout(
					() =>
						reject(new Error('Worker version response timed out.')),
					5_000
				);
				const receive = (event: MessageEvent<unknown>) => {
					if (
						typeof event.data !== 'object' ||
						event.data === null ||
						Reflect.get(event.data, 'type') !==
							'ABSOLUTE_TEST_WORKER_VERSION'
					)
						return;
					globalThis.clearTimeout(timeout);
					navigator.serviceWorker.removeEventListener(
						'message',
						receive
					);
					resolve(String(Reflect.get(event.data, 'version')));
				};
				navigator.serviceWorker.addEventListener('message', receive);
				navigator.serviceWorker.controller?.postMessage({
					type: 'ABSOLUTE_TEST_WORKER_VERSION'
				});
			})
	);

const cleanup = async () => {
	await context?.close().catch(() => undefined);
	context = undefined;
	server?.stop(true);
	server = undefined;
	const build = buildDirectory;
	const profile = profileDirectory;
	buildDirectory = '';
	profileDirectory = '';
	if (build) await rm(build, { force: true, recursive: true });
	if (profile) await rm(profile, { force: true, recursive: true });
};

afterAll(cleanup);

const runUpdateActivationConformance = async () => {
	buildDirectory = await mkdtemp(join(FIXTURE, '.update-build-'));
	profileDirectory = await mkdtemp(
		join(tmpdir(), 'absolute-pwa-update-profile-')
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

	const generatedWorker = await readFile(
		join(buildDirectory, 'sw.js'),
		'utf8'
	);
	let workerSource = versionedWorker(generatedWorker, 'v1');
	let documentRequests = 0;
	const port = await getAvailablePort();
	server = Bun.serve({
		hostname: '127.0.0.1',
		port,
		fetch: (request) => {
			const url = new URL(request.url);
			if (url.pathname === '/sw.js') {
				return new Response(workerSource, {
					headers: {
						'cache-control': 'no-store',
						'content-type': 'text/javascript',
						'service-worker-allowed': '/'
					}
				});
			}
			if (url.pathname === '/pages/index.html') documentRequests += 1;
			if (url.pathname === '/__absolute/sync/principal') {
				return Response.json(
					{ error: 'unauthenticated' },
					{ status: 401 }
				);
			}

			const decoded = decodeURIComponent(url.pathname);
			const relative = decoded === '/' ? '/pages/index.html' : decoded;
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

	context = await chromium.launchPersistentContext(profileDirectory, {
		args: CHROMIUM_ARGS,
		headless: true,
		viewport: { height: 720, width: 1280 }
	});
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`${origin}/pages/index.html`, { waitUntil: 'load' });
	await page.waitForFunction(
		() => navigator.serviceWorker.controller !== null,
		undefined,
		{ timeout: 15_000 }
	);
	expect(await controllerVersion(page)).toBe('v1');
	expect(documentRequests).toBe(1);

	workerSource = versionedWorker(generatedWorker, 'v2');
	await page.evaluate(async () => {
		const check = Reflect.get(globalThis, '__PWA_CHECK_FOR_UPDATE__');
		if (typeof check !== 'function')
			throw new Error('Missing update check.');
		await Reflect.apply(check, undefined, []);
	});
	await page.waitForFunction(
		async () =>
			Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
		undefined,
		{ timeout: 15_000 }
	);
	await page.waitForFunction(
		() => {
			const updates = Reflect.get(globalThis, '__PWA_UPDATES__');

			return (
				Array.isArray(updates) &&
				updates.some(
					(update) =>
						Array.isArray(update.sources) &&
						update.sources.includes('service-worker')
				)
			);
		},
		undefined,
		{ timeout: 15_000 }
	);

	// Passive discovery must leave v1 controlling and must not reload.
	expect(await controllerVersion(page)).toBe('v1');
	expect(documentRequests).toBe(1);
	expect(
		await page.evaluate(async () =>
			Boolean((await navigator.serviceWorker.getRegistration())?.waiting)
		)
	).toBe(true);

	const navigation = page.waitForNavigation({ waitUntil: 'load' });
	await page.evaluate(() => {
		const apply = Reflect.get(globalThis, '__PWA_APPLY_UPDATE__');
		if (typeof apply !== 'function')
			throw new Error('Missing update apply.');
		void Reflect.apply(apply, undefined, []);
	});
	await navigation;
	await page.waitForFunction(
		() => navigator.serviceWorker.controller !== null,
		undefined,
		{ timeout: 15_000 }
	);
	expect(await controllerVersion(page)).toBe('v2');
	expect(documentRequests).toBe(2);
	expect(
		await page.evaluate(async () =>
			Boolean((await navigator.serviceWorker.getRegistration())?.waiting)
		)
	).toBe(false);
};

const CLOSED_BROWSER =
	/target page, context or browser has been closed|browser has been closed/iu;
const MAX_BROWSER_ATTEMPTS = 3;

describe('PWA explicit update activation', () => {
	test('keeps a new worker waiting until applyUpdate activates and reloads it', async () => {
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_BROWSER_ATTEMPTS; attempt += 1) {
			try {
				await runUpdateActivationConformance();

				return;
			} catch (error) {
				lastError = error;
				await cleanup();
				const message =
					error instanceof Error ? error.message : String(error);
				if (!CLOSED_BROWSER.test(message)) throw error;
			}
		}

		throw lastError ?? new Error('Chromium update conformance failed.');
	}, 90_000);
});
