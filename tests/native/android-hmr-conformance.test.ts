import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test
} from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import config from '../fixtures/mobile-native-conformance/absolute.config';
import { startDevServer, type DevServer } from '../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../helpers/file';
import {
	prepareAbsoluteAndroidDevProject,
	startAbsoluteAndroidDevSession,
	type AbsoluteAndroidDevProject,
	type AbsoluteAndroidDevSession
} from '../../src/mobile/androidEmulatorController';
import {
	attachAbsoluteAndroidWebView,
	type AbsoluteAndroidWebViewSession
} from '../../src/mobile/androidWebView';
import {
	inspectAbsoluteAndroidRoute,
	waitForAbsoluteAndroidHmrApply
} from '../../src/mobile/androidConformance';
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_ANDROID === '1';
const NATIVE_TEST_PORT =
	Number(process.env.ABSOLUTE_NATIVE_TEST_PORT) || 39_077;
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/artifacts'
);
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');
const SVELTE_COUNTER = resolve(
	PROJECT_ROOT,
	'example/svelte/components/Counter.svelte'
);
const SYSTEM_UI_COMPONENT = resolve(
	PROJECT_ROOT,
	'example/react/components/NativeSystemUiAcceptance.tsx'
);
const SVELTE_RUNE_COUNTER = `<script lang="ts">
	let { initialCount } = $props<{ initialCount: number }>();
	let count = $state(initialCount);
	function increment() { count = count + 1; }
</script>

<button onclick={increment}>count is {count}</button>
`;

let server: DevServer;
let project: AbsoluteAndroidDevProject;
let android: AbsoluteAndroidDevSession;
let webview: AbsoluteAndroidWebViewSession;
let originalCapacitorConfig: string | undefined;

const mobileConfig = () => {
	if (!config.mobile) throw new Error('Native mobile fixture is invalid.');

	return normalizeAbsoluteMobileConfig(config.mobile, PROJECT_ROOT);
};

const waitForServerIdle = async () => {
	await Bun.sleep(1_000);
	const deadline = Date.now() + 30_000;
	let stable = 0;
	while (Date.now() < deadline) {
		const status = (await (
			await fetch(`${server.baseUrl}/hmr-status`)
		).json()) as { isRebuilding?: boolean; rebuildQueue?: unknown[] };
		if (
			status.isRebuilding === false &&
			(status.rebuildQueue?.length ?? 0) === 0
		) {
			stable += 1;
			if (stable >= 3) return;
		} else {
			stable = 0;
		}
		await Bun.sleep(100);
	}
	throw new Error('Native conformance dev server did not become idle.');
};

const waitForBodyText = (text: string, timeoutMs = 30_000) =>
	webview.waitFor<boolean>(
		`document.body?.innerText?.includes(${JSON.stringify(text)}) === true`,
		{ timeoutMs }
	);

const currentUpdateId = () =>
	webview.evaluate<number | undefined>(
		'window.__ABS_HMR_LAST_APPLY__?.updateId'
	);

const reconnectWebView = async () => {
	await webview?.close().catch(() => undefined);
	const stopped = Bun.spawnSync([
		project.adb,
		'-s',
		android.serial,
		'shell',
		'am',
		'force-stop',
		mobileConfig().appId
	]);
	if (stopped.exitCode !== 0) {
		throw new Error(
			`Failed to stop Android HMR fixture: ${stopped.stderr.toString().trim() || stopped.stdout.toString().trim()}`
		);
	}
	await android.relaunch();
	webview = await attachAbsoluteAndroidWebView({
		adb: project.adb,
		appId: mobileConfig().appId,
		serial: android.serial,
		timeoutMs: 60_000
	});
};

const route = async (path: string) => {
	try {
		return await inspectAbsoluteAndroidRoute(webview, {
			port: server.port,
			route: path,
			timeoutMs: 45_000
		});
	} catch (firstError) {
		console.warn(
			`[native-test] Android route ${path} did not settle; relaunching once: ${firstError instanceof Error ? firstError.message : String(firstError)}`
		);
		await reconnectWebView();

		return inspectAbsoluteAndroidRoute(webview, {
			port: server.port,
			route: path,
			timeoutMs: 45_000
		});
	}
};

const expectHmr = async (
	kind: Parameters<typeof waitForAbsoluteAndroidHmrApply>[1]['kind'],
	baseline: number | undefined
) => {
	const apply = await waitForAbsoluteAndroidHmrApply(webview, {
		afterUpdateId: baseline,
		kind,
		timeoutMs: 45_000
	});
	expect(apply.target).toBe('capacitor-android');
	expect(apply.outcome).not.toBe('failed');
	expect(apply.duration).toBeLessThan(15_000);

	return apply;
};

const nativeTest = (name: string, fn: () => Promise<void>) =>
	test(
		name,
		async () => {
			try {
				await fn();
			} catch (error) {
				await mkdir(ARTIFACT_ROOT, { recursive: true });
				const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-');
				const diagnostics = await webview
					?.evaluate(
						`({
						bodyText: document.body?.innerText,
						errorOverlay: document.querySelector('#absolutejs-error-overlay')?.textContent,
						hmrApplies: window.__ABS_HMR_APPLIES__,
						hmrLastApply: window.__ABS_HMR_LAST_APPLY__,
						hmrTarget: window.__ABS_HMR_TARGET__,
						location: location.href,
						webSocketState: window.__HMR_WS__?.readyState
					})`
					)
					.catch(() => undefined);
				await writeFile(
					resolve(ARTIFACT_ROOT, `${slug}.json`),
					JSON.stringify(
						{
							diagnostics,
							serverOutput: server?.outputLines.slice(-100)
						},
						null,
						2
					)
				).catch(() => undefined);
				await webview
					?.screenshot(resolve(ARTIFACT_ROOT, `${slug}.png`))
					.catch(() => undefined);
				throw error;
			}
		},
		180_000
	);

describeNative('real Capacitor Android HMR conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		server = await startDevServer({
			configPath: CONFIG_PATH,
			port: NATIVE_TEST_PORT
		});
		const mobile = mobileConfig();
		project = await prepareAbsoluteAndroidDevProject(mobile, {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		android = await startAbsoluteAndroidDevSession({
			port: server.port,
			project,
			log: (message) => console.log(`[native-test] ${message}`),
			nativeLog: (entry) => {
				if (entry.level === 'error' || entry.level === 'fatal') {
					console.error(`[android:${entry.tag}] ${entry.message}`);
				}
			}
		});
		webview = await attachAbsoluteAndroidWebView({
			adb: project.adb,
			appId: mobile.appId,
			serial: android.serial,
			timeoutMs: 60_000
		});
	}, 600_000);

	afterEach(async () => {
		restoreAllFiles();
		await waitForServerIdle();
		// Keep restore HMR from the previous framework out of the next case and
		// discard WebView cache state left by full-page fallback reloads.
		await reconnectWebView();
	}, 60_000);

	afterAll(async () => {
		restoreAllFiles();
		await webview?.close().catch(() => undefined);
		await android?.close().catch(() => undefined);
		await server?.kill().catch(() => undefined);
		if (originalCapacitorConfig === undefined) {
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		} else {
			await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
		}
	}, 60_000);

	nativeTest(
		'applies Angular component HMR in the real WebView',
		async () => {
			await route('/angular');
			const baseline = await currentUpdateId();
			mutateFile(
				resolve(
					PROJECT_ROOT,
					'example/angular/templates/counter.component.html'
				),
				(source) => source.replace('count is', 'android tally is')
			);
			await waitForBodyText('android tally is');
			await expectHmr('component', baseline);
		}
	);

	nativeTest('applies React component HMR in the real WebView', async () => {
		await route('/react');
		const baseline = await currentUpdateId();
		mutateFile(
			resolve(PROJECT_ROOT, 'example/react/components/App.tsx'),
			(source) =>
				source.replace(
					'AbsoluteJS + React',
					'AbsoluteJS + React Android Native'
				)
		);
		await waitForBodyText('AbsoluteJS + React Android Native');
		await expectHmr('component', baseline);
	});

	nativeTest(
		'applies portable system-UI HMR without losing the native adapter',
		async () => {
			await route('/native-system-ui');
			await webview.waitFor<boolean>(
				`window.__ABS_NATIVE_DEVICES_READY_STATE__ === 'ready'`,
				{ timeoutMs: 30_000 }
			);
			const queried = await webview.evaluate<boolean>(`(() => {
				const button = document.querySelector('#system-ui-query');
				if (!(button instanceof HTMLButtonElement)) return false;
				button.click();
				return true;
			})()`);
			expect(queried).toBe(true);
			await webview.waitFor<boolean>(
				`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') === 'native'`,
				{ timeoutMs: 30_000 }
			);
			const baseline = await currentUpdateId();
			mutateFile(SYSTEM_UI_COMPONENT, (source) =>
				source.replace(
					'AbsoluteJS System UI</h1>',
					'AbsoluteJS System UI Android HMR</h1>'
				)
			);
			await waitForBodyText('AbsoluteJS System UI Android HMR');
			await expectHmr('component', baseline);
			await webview.waitFor<boolean>(
				`window.__ABS_NATIVE_DEVICES_READY_STATE__ === 'ready'`,
				{ timeoutMs: 30_000 }
			);
			const requeried = await webview.evaluate<boolean>(`(() => {
				const button = document.querySelector('#system-ui-query');
				if (!(button instanceof HTMLButtonElement)) return false;
				button.click();
				return true;
			})()`);
			expect(requeried).toBe(true);
			await webview.waitFor<boolean>(
				`document.querySelector('[data-system-bars]')?.getAttribute('data-system-bars') === 'native'`,
				{ timeoutMs: 30_000 }
			);
			const clicked = await webview.evaluate<boolean>(`(() => {
				const button = document.querySelector('#system-ui-dark');
				if (!(button instanceof HTMLButtonElement)) return false;
				button.click();
				return true;
			})()`);
			expect(clicked).toBe(true);
			await webview.waitFor<boolean>(
				`document.querySelector('#system-ui-detail')?.textContent === 'Dark foreground applied'`,
				{ timeoutMs: 30_000 }
			);
		}
	);

	nativeTest('applies Vue component HMR in the real WebView', async () => {
		await route('/vue');
		const baseline = await currentUpdateId();
		mutateFile(
			resolve(PROJECT_ROOT, 'example/vue/components/CountButton.vue'),
			(source) =>
				source.replace(
					'</button>',
					'</button><span>VUE_ANDROID_NATIVE</span>'
				)
		);
		await waitForBodyText('VUE_ANDROID_NATIVE');
		await expectHmr('component', baseline);
	});

	nativeTest('applies Svelte component HMR in the real WebView', async () => {
		mutateFile(SVELTE_COUNTER, () => SVELTE_RUNE_COUNTER);
		await waitForServerIdle();
		await route('/svelte');
		const baseline = await currentUpdateId();
		mutateFile(SVELTE_COUNTER, (source) =>
			source.replace(
				'</button>',
				'</button><span>SVELTE_ANDROID_NATIVE</span>'
			)
		);
		await waitForBodyText('SVELTE_ANDROID_NATIVE');
		await expectHmr('component', baseline);
	});

	nativeTest('applies HTML HMR in the real WebView', async () => {
		await route('/html');
		const baseline = await currentUpdateId();
		mutateFile(
			resolve(PROJECT_ROOT, 'example/html/pages/HTMLExample.html'),
			(source) =>
				source.replace(
					'AbsoluteJS + HTML</h1>',
					'AbsoluteJS + HTML Android Native</h1>'
				)
		);
		await waitForBodyText('AbsoluteJS + HTML Android Native');
		await expectHmr('html', baseline);
	});

	nativeTest('applies HTMX HMR in the real WebView', async () => {
		await route('/htmx');
		const baseline = await currentUpdateId();
		mutateFile(
			resolve(PROJECT_ROOT, 'example/htmx/pages/HTMXExample.html'),
			(source) =>
				source.replace(
					'AbsoluteJS + HTMX</h1>',
					'AbsoluteJS + HTMX Android Native</h1>'
				)
		);
		await waitForBodyText('AbsoluteJS + HTMX Android Native');
		await expectHmr('htmx', baseline);
	});

	nativeTest(
		'reports Ember reload fallback in the real WebView',
		async () => {
			await route('/ember');
			const outputStart = server.outputLines.length;
			mutateFile(
				resolve(PROJECT_ROOT, 'example/ember/pages/EmberExample.gts'),
				(source) =>
					source.replace(
						'AbsoluteJS + Ember</h1>',
						'AbsoluteJS + Ember Android Native</h1>'
					)
			);
			await waitForBodyText('AbsoluteJS + Ember Android Native', 60_000);
			const deadline = Date.now() + 45_000;
			while (Date.now() < deadline) {
				if (
					server.outputLines
						.slice(outputStart)
						.some((line) =>
							/\[hmr:android\].*ember.*full-reload.*reload after/u.test(
								line
							)
						)
				) {
					return;
				}
				await Bun.sleep(100);
			}
			throw new Error(
				'Ember native reload acknowledgement was not emitted.'
			);
		}
	);

	nativeTest('applies CSS without replacing the real WebView', async () => {
		await route('/react');
		const baseline = await currentUpdateId();
		mutateFile(
			resolve(PROJECT_ROOT, 'example/styles/indexes/react-example.css'),
			(source) => `${source}\n/* real-android-css-conformance */\n`
		);
		await expectHmr('css', baseline);
		expect(await waitForBodyText('AbsoluteJS + React')).toBe(true);
	});

	nativeTest(
		'recovers the real WebView error overlay through HMR',
		async () => {
			await route('/react');
			await webview.evaluate(
				`setTimeout(() => { throw new Error('real-android-overlay-sentinel'); }, 0)`
			);
			await webview.waitFor<boolean>(
				`document.querySelector('#absolutejs-error-overlay') !== null`,
				{ timeoutMs: 30_000 }
			);
			const baseline = await currentUpdateId();
			mutateFile(
				resolve(PROJECT_ROOT, 'example/react/components/App.tsx'),
				(source) =>
					source.replace(
						'AbsoluteJS + React',
						'AbsoluteJS + React Android Recovered'
					)
			);
			await waitForBodyText('AbsoluteJS + React Android Recovered');
			await expectHmr('component', baseline);
			expect(
				await webview.waitFor<boolean>(
					`document.querySelector('#absolutejs-error-overlay') === null`
				)
			).toBe(true);
		}
	);

	nativeTest('survives Android background and app relaunch', async () => {
		await route('/react');
		const home = Bun.spawnSync([
			project.adb,
			'-s',
			android.serial,
			'shell',
			'input',
			'keyevent',
			'KEYCODE_HOME'
		]);
		expect(home.exitCode).toBe(0);
		await webview.close().catch(() => undefined);
		await reconnectWebView();
		await webview.waitFor<boolean>(
			`document.visibilityState === 'visible'`,
			{ timeoutMs: 30_000 }
		);
		const check = await route('/react');
		expect(check.hmrConnected).toBe(true);
	});
});
