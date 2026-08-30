import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { resolve } from 'node:path';
import { openPage, type BrowserSession } from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const NATIVE_TARGET = '__absolute_target=capacitor-android';
const MAX_NATIVE_APPLY_MS = 2_000;
const NATIVE_HMR_CONVERGENCE_TIMEOUT_MS = 60_000;
const SVELTE_COUNTER = resolve(
	PROJECT_ROOT,
	'example/svelte/components/Counter.svelte'
);
const SVELTE_RUNE_COUNTER = `<script lang="ts">
	let { initialCount } = $props<{ initialCount: number }>();
	let count = $state(initialCount);
	function increment() { count = count + 1; }
</script>

<button onclick={increment}>count is {count}</button>
`;

let server: DevServer | undefined;
let session: BrowserSession | undefined;

const closeSession = async () => {
	const current = session;
	session = undefined;
	await current?.close();
};

afterEach(async () => {
	await closeSession();
	restoreAllFiles();
	await server?.kill();
	server = undefined;
}, 150_000);

const startConformanceServer = async () => {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await startDevServer();
		} catch (error) {
			lastError = error;
			await Bun.sleep(500);
		}
	}
	throw lastError;
};

beforeEach(async () => {
	server = await startConformanceServer();
}, 150_000);

afterAll(async () => {
	restoreAllFiles();
	await closeSession();
	await server?.kill();
	server = undefined;
}, 30_000);

const nativeUrl = (route: string) =>
	`${server?.baseUrl}${route}?${NATIVE_TARGET}`;

const expectBoundedNativeApply = async (
	pattern: RegExp,
	maxDurationMs = MAX_NATIVE_APPLY_MS
) => {
	if (!server) throw new Error('dev server missing');
	const line = await server.waitForOutput(pattern, {
		timeoutMs: NATIVE_HMR_CONVERGENCE_TIMEOUT_MS
	});
	const duration = /(?:applied in|reload after) ([\d.]+)ms/.exec(line)?.[1];
	expect(duration).toBeDefined();
	expect(Number(duration)).toBeLessThan(maxDurationMs);
};

const withNativePage = async (
	route: string,
	readySelector: string,
	action: (
		page: Awaited<ReturnType<typeof openPage>>['page']
	) => Promise<void>
) => {
	for (let attempt = 0; attempt < 3; attempt++) {
		let actionStarted = false;
		try {
			await closeSession();
			session = await openPage(nativeUrl(route), {
				waitUntil: 'commit'
			});
			session.page.setDefaultTimeout(NATIVE_HMR_CONVERGENCE_TIMEOUT_MS);
			await session.page.waitForSelector(readySelector, {
				timeout: 10_000
			});
			await session.page.waitForFunction(
				() => window.__HMR_WS__?.readyState === WebSocket.OPEN,
				undefined,
				{ timeout: 10_000 }
			);
			await session.page.waitForFunction(
				() => window.__ABS_HMR_TARGET__ === 'capacitor-android',
				undefined,
				{ timeout: 10_000 }
			);
			await session.page.waitForFunction(
				() => document.readyState !== 'loading',
				undefined,
				{ timeout: 10_000 }
			);
			if (!server) throw new Error('dev server missing');
			// Page hydration can finish while its initial framework compilation is
			// still draining. Mutating in that window makes this conformance edit
			// compete with boot work instead of testing a steady-state HMR cycle.
			await server.waitForIdle({
				timeoutMs: NATIVE_HMR_CONVERGENCE_TIMEOUT_MS
			});
			actionStarted = true;
			await action(session.page);

			return;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			const browserClosed =
				/page, context or browser has been closed|target page, context or browser has been closed/i.test(
					message
				);
			const retryableBrowserClosed = !actionStarted && browserClosed;
			const readinessTimeout =
				!actionStarted &&
				error instanceof Error &&
				error.name === 'TimeoutError';
			const browserLaunchUnavailable =
				!actionStarted && /Failed to connect|ENOENT/iu.test(message);
			const serverNotReady =
				!actionStarted && /net::ERR_CONNECTION_REFUSED/iu.test(message);
			if (
				attempt >= 2 ||
				(!retryableBrowserClosed &&
					!readinessTimeout &&
					!browserLaunchUnavailable &&
					!serverNotReady)
			) {
				throw error;
			}
			await closeSession();
			if (readinessTimeout || serverNotReady) {
				await server?.kill();
				server = await startConformanceServer();
			}
			await Bun.sleep(100);
		}
	}
};

const nativeTest = (label: string, fn: () => void | Promise<unknown>) =>
	test(label, fn, { retry: 2, timeout: 150_000 });

describe('native-target all-framework HMR conformance', () => {
	nativeTest(
		'Angular applies with a native target acknowledgement',
		async () => {
			await withNativePage(
				'/angular',
				'app-counter button',
				async (page) => {
					mutateFile(
						resolve(
							PROJECT_ROOT,
							'example/angular/templates/counter.component.html'
						),
						(source) =>
							source.replace('count is', 'native tally is')
					);
					await page.getByText(/native tally is/).waitFor();
					if (!server) throw new Error('dev server missing');
					await server.waitForOutput(
						/\[ng-hmr:capacitor-android\].*applied in/,
						{ timeoutMs: 30_000 }
					);
				}
			);
		}
	);

	nativeTest('HTML applies with native target timing', async () => {
		await withNativePage('/html', 'h1', async (page) => {
			mutateFile(
				resolve(PROJECT_ROOT, 'example/html/pages/HTMLExample.html'),
				(source) =>
					source.replace(
						'AbsoluteJS + HTML</h1>',
						'AbsoluteJS + HTML Native Target</h1>'
					)
			);
			await page.getByText('AbsoluteJS + HTML Native Target').waitFor();
			await expectBoundedNativeApply(
				/\[hmr:android\].*html.*html.*applied in/
			);
		});
	});

	nativeTest(
		'Ember reports its explicit native reload fallback',
		async () => {
			await withNativePage('/ember', 'h1', async (page) => {
				mutateFile(
					resolve(
						PROJECT_ROOT,
						'example/ember/pages/EmberExample.gts'
					),
					(source) =>
						source.replace(
							'AbsoluteJS + Ember</h1>',
							'AbsoluteJS + Ember Native Target</h1>'
						)
				);
				await expectBoundedNativeApply(
					/\[hmr:android\].*ember.*full-reload.*reload after/,
					15_000
				);
				if (!server) throw new Error('dev server missing');
				const html = await (
					await fetch(`${server.baseUrl}/ember`)
				).text();
				expect(html).toContain('AbsoluteJS + Ember Native Target');
				await Bun.sleep(500);
				await page.waitForLoadState('domcontentloaded');
			});
		}
	);

	nativeTest('React applies with native target timing', async () => {
		await withNativePage('/react', 'h1', async (page) => {
			mutateFile(
				resolve(PROJECT_ROOT, 'example/react/components/App.tsx'),
				(source) =>
					source.replace(
						'AbsoluteJS + React',
						'AbsoluteJS + React Native Target'
					)
			);
			await page.getByText('AbsoluteJS + React Native Target').waitFor();
			await expectBoundedNativeApply(
				/\[hmr:android\].*react.*component.*applied in/
			);
		});
	});

	nativeTest('Vue applies with native target timing', async () => {
		await withNativePage(
			'/vue',
			'button[data-v-count-button]',
			async (page) => {
				mutateFile(
					resolve(
						PROJECT_ROOT,
						'example/vue/components/CountButton.vue'
					),
					(source) =>
						source.replace(
							'</button>',
							'</button><span data-native-vue>VUE_NATIVE_OK</span>'
						)
				);
				await page.locator('[data-native-vue]').waitFor();
				await expectBoundedNativeApply(
					/\[hmr:android\].*vue.*component.*applied in/
				);
			}
		);
	});

	nativeTest('HTMX applies with native target timing', async () => {
		await withNativePage('/htmx', 'h1', async (page) => {
			mutateFile(
				resolve(PROJECT_ROOT, 'example/htmx/pages/HTMXExample.html'),
				(source) =>
					source.replace(
						'AbsoluteJS + HTMX</h1>',
						'AbsoluteJS + HTMX Native Target</h1>'
					)
			);
			await page.getByText('AbsoluteJS + HTMX Native Target').waitFor();
			await expectBoundedNativeApply(
				/\[hmr:android\].*htmx.*htmx.*applied in/
			);
		});
	});

	nativeTest('CSS applies without discarding the active page', async () => {
		await withNativePage('/react', 'h1', async (page) => {
			mutateFile(
				resolve(
					PROJECT_ROOT,
					'example/styles/indexes/react-example.css'
				),
				(source) => `${source}\n/* native-css-conformance */\n`
			);
			await expectBoundedNativeApply(/\[hmr:android\].*css.*applied in/);
			expect(await page.locator('h1').count()).toBeGreaterThan(0);
		});
	});

	nativeTest(
		'native target clears a runtime error overlay on the next valid HMR edit',
		async () => {
			const reactPage = resolve(
				PROJECT_ROOT,
				'example/react/components/App.tsx'
			);
			await withNativePage('/react', 'h1', async (page) => {
				await page.evaluate(() => {
					setTimeout(() => {
						throw new Error('native-runtime-recovery-sentinel');
					}, 0);
				});
				await page
					.locator('#absolutejs-error-overlay')
					.waitFor({ timeout: 30_000 });
				expect(
					await page.evaluate(() => window.__ABS_HMR_TARGET__)
				).toBe('capacitor-android');

				mutateFile(reactPage, (source) =>
					source.replace(
						'AbsoluteJS + React',
						'AbsoluteJS + React Recovered'
					)
				);
				await page.getByText('AbsoluteJS + React Recovered').waitFor();
				await page
					.locator('#absolutejs-error-overlay')
					.waitFor({ state: 'detached', timeout: 30_000 });
				if (!server) throw new Error('dev server missing');
				expect(
					(await fetch(`${server.baseUrl}/hmr-status`)).status
				).toBe(200);
			});
		}
	);

	nativeTest('Svelte applies with native target timing', async () => {
		if (!server) throw new Error('dev server missing');
		const setupClient = await connectHMR(server.port);
		await setupClient.waitFor('manifest');
		await setupClient.waitFor('connected');
		setupClient.drain();
		mutateFile(SVELTE_COUNTER, () => SVELTE_RUNE_COUNTER);
		await setupClient.waitFor('svelte-update', 30_000);
		setupClient.close();
		await server.kill();
		server = await startConformanceServer();
		await withNativePage('/svelte', 'h1', async (page) => {
			await page.waitForFunction(
				() => window.__SVELTE_COMPONENT__ !== undefined,
				undefined,
				{ timeout: 20_000 }
			);
			mutateFile(SVELTE_COUNTER, (source) =>
				source.replace(
					'</button>',
					'</button><span data-native-svelte>SVELTE_NATIVE_OK</span>'
				)
			);
			await page.locator('[data-native-svelte]').waitFor();
			await expectBoundedNativeApply(
				/\[hmr:android\].*svelte.*component.*applied in/
			);
		});
	});
});
