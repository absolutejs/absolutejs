import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Elysia } from 'elysia';
import config from '../fixtures/mobile-native-conformance/absolute.config';
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
import { normalizeAbsoluteMobileConfig } from '../../src/mobile/config';

const ENABLED = process.env.ABSOLUTE_TEST_NATIVE_ANDROID === '1';
const describeNative = ENABLED ? describe : describe.skip;
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
const BUILD_DIRECTORY = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/embedded-server'
);
const ARTIFACT_ROOT = resolve(
	PROJECT_ROOT,
	'.absolutejs/mobile-native-conformance/embedded-artifacts'
);
const CAPACITOR_CONFIG_PATH = resolve(PROJECT_ROOT, 'capacitor.config.ts');
const PORT = Number(process.env.ABSOLUTE_NATIVE_BUNDLE_TEST_PORT) || 39_080;
const PRODUCTION_ORIGIN = `http://localhost:${PORT}`;
const TIMEOUT_MS = 60_000;

let backend: ReturnType<typeof Bun.serve> | undefined;
let project: AbsoluteAndroidDevProject;
let android: AbsoluteAndroidDevSession;
let webview: AbsoluteAndroidWebViewSession;
let originalCapacitorConfig: string | undefined;

type CompiledAppEnvironment = {
	buildDirectory: string | undefined;
	compiledRuntime: string | undefined;
	config: string | undefined;
	nodeEnv: string | undefined;
};

const runPrepare = async () => {
	const process = Bun.spawn(
		[
			'bun',
			'run',
			'src/cli/index.ts',
			'prepare',
			'example/server.ts',
			'--outdir',
			BUILD_DIRECTORY,
			'--config',
			CONFIG_PATH
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...Bun.env,
				ABSOLUTE_NATIVE_CONFORMANCE_ORIGIN: PRODUCTION_ORIGIN
			},
			stderr: 'inherit',
			stdout: 'inherit'
		}
	);
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(
			`Embedded mobile production build failed (${exitCode}).`
		);
	}
};

const loadCompiledApp = async () => {
	const previous: CompiledAppEnvironment = {
		buildDirectory: process.env.ABSOLUTE_BUILD_DIR,
		compiledRuntime: process.env.ABSOLUTE_COMPILED_RUNTIME,
		config: process.env.ABSOLUTE_CONFIG,
		nodeEnv: process.env.NODE_ENV
	};
	process.env.ABSOLUTE_BUILD_DIR = BUILD_DIRECTORY;
	process.env.ABSOLUTE_COMPILED_RUNTIME = '1';
	process.env.ABSOLUTE_CONFIG = CONFIG_PATH;
	process.env.NODE_ENV = 'production';
	try {
		const loaded: { server?: Elysia } = await import(
			`${pathToFileURL(resolve(BUILD_DIRECTORY, 'server.js')).href}?embedded=${crypto.randomUUID()}`
		);
		if (!loaded.server) {
			throw new Error(
				'Compiled conformance server did not export `server`.'
			);
		}

		return loaded.server;
	} finally {
		const restore = (name: keyof typeof process.env, value?: string) => {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		};
		restore('ABSOLUTE_BUILD_DIR', previous.buildDirectory);
		restore('ABSOLUTE_COMPILED_RUNTIME', previous.compiledRuntime);
		restore('ABSOLUTE_CONFIG', previous.config);
		restore('NODE_ENV', previous.nodeEnv);
	}
};

const waitForText = (text: string) =>
	webview.waitFor<boolean>(
		`document.body?.innerText?.includes(${JSON.stringify(text)}) === true`,
		{ timeoutMs: TIMEOUT_MS }
	);

const navigate = async (path: string, expectedText: string) => {
	const clicked = await webview.evaluate<boolean>(`(() => {
		const anchor = [...document.querySelectorAll('a[href]')].find((candidate) => {
			try { return new URL(candidate.href).pathname === ${JSON.stringify(path)}; }
			catch { return false; }
		});
		if (!(anchor instanceof HTMLAnchorElement)) return false;
		anchor.click();
		return true;
	})()`);
	expect(clicked).toBe(true);
	await waitForText(expectedText);
};

const nativeTest = (name: string, operation: () => Promise<void>) =>
	test(
		name,
		async () => {
			try {
				await operation();
			} catch (error) {
				await mkdir(ARTIFACT_ROOT, { recursive: true });
				const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-');
				const documentState = await webview
					?.evaluate(
						`(() => ({
						bodyText: document.body?.innerText ?? '',
						counter: document.querySelector('#counter')?.textContent ?? null,
						location: location.href,
						scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type })),
						counterListeners: typeof getEventListeners === 'function' && document.querySelector('#counter-button')
							? Object.keys(getEventListeners(document.querySelector('#counter-button')))
							: [],
						title: document.title
					}))()`
					)
					.catch(() => undefined);
				await webview
					?.screenshot(resolve(ARTIFACT_ROOT, `${slug}.png`))
					.catch(() => undefined);
				await writeFile(
					resolve(ARTIFACT_ROOT, `${slug}.json`),
					`${JSON.stringify(
						{
							diagnostics: webview?.diagnostics ?? [],
							document: documentState,
							error:
								error instanceof Error
									? {
											message: error.message,
											stack: error.stack
										}
									: String(error)
						},
						null,
						2
					)}\n`
				);
				throw error;
			}
		},
		300_000
	);

describeNative('real Capacitor Android embedded-bundle conformance', () => {
	beforeAll(async () => {
		originalCapacitorConfig = await readFile(
			CAPACITOR_CONFIG_PATH,
			'utf8'
		).catch(() => undefined);
		await runPrepare();
		const app = await loadCompiledApp();
		app.get(
			'/__absolute/native-fragment',
			() =>
				new Response(
					'<section id="trusted-fragment" onclick="window.__ABS_BAD_HANDLER__=true"><script>window.__ABS_BAD_SCRIPT__=true</script><button id="safe-fragment-action" hx-post="/htmx/increment">Native fragment safe</button><button id="unsafe-fragment-action" hx-post="https://evil.example/steal">Unsafe</button></section>',
					{ headers: { 'content-type': 'text/html' } }
				)
		);
		backend = Bun.serve({
			hostname: '127.0.0.1',
			port: PORT,
			fetch: (request) => app.handle(request)
		});
		if (!config.mobile)
			throw new Error('Native mobile fixture is invalid.');
		const mobile = normalizeAbsoluteMobileConfig(
			{
				...config.mobile,
				server: { productionOrigin: PRODUCTION_ORIGIN }
			},
			PROJECT_ROOT
		);
		project = await prepareAbsoluteAndroidDevProject(mobile, {
			createNativeProject: true,
			projectRoot: PROJECT_ROOT
		});
		android = await startAbsoluteAndroidDevSession({
			embeddedBundle: true,
			port: PORT,
			project,
			log: (message) => console.log(`[native-bundle] ${message}`)
		});
		webview = await attachAbsoluteAndroidWebView({
			adb: project.adb,
			appId: mobile.appId,
			serial: android.serial,
			timeoutMs: TIMEOUT_MS
		});
		await waitForText('AbsoluteJS + React');
	}, 900_000);

	afterAll(async () => {
		await webview?.close().catch(() => undefined);
		await android?.close().catch(() => undefined);
		backend?.stop(true);
		if (originalCapacitorConfig === undefined)
			await unlink(CAPACITOR_CONFIG_PATH).catch(() => undefined);
		else await writeFile(CAPACITOR_CONFIG_PATH, originalCapacitorConfig);
	}, 120_000);

	nativeTest(
		'renders every supported framework from the embedded app',
		async () => {
			await navigate('/angular', 'AbsoluteJS + Angular');
			await navigate('/vue', 'AbsoluteJS + Vue');
			await navigate('/svelte', 'AbsoluteJS + Svelte');
			await navigate('/html', 'AbsoluteJS + HTML');
			await navigate('/htmx', 'AbsoluteJS + HTMX');
			await navigate('/react', 'AbsoluteJS + React');
		}
	);

	nativeTest(
		'executes the hashed local HTML application script',
		async () => {
			await navigate('/html', 'AbsoluteJS + HTML');
			const clicked = await webview.evaluate<boolean>(`(() => {
			const button = document.querySelector('#counter-button');
			if (!(button instanceof HTMLButtonElement)) return false;
			button.click();
			return true;
		})()`);
			expect(clicked).toBe(true);
			await webview.waitFor<boolean>(
				`document.querySelector('#counter')?.textContent?.trim() === '1'`,
				{ timeoutMs: TIMEOUT_MS }
			);
		}
	);

	nativeTest(
		'routes HTMX to the backend and sanitizes returned fragments',
		async () => {
			await navigate('/htmx', 'AbsoluteJS + HTMX');
			await webview.waitFor<boolean>(
				`document.querySelector('#count')?.textContent?.trim() === '0'`,
				{ timeoutMs: TIMEOUT_MS }
			);
			const requested = await webview.evaluate<boolean>(`(() => {
			const target = document.createElement('div');
			target.id = 'native-fragment-target';
			document.body.appendChild(target);
			window.__ABS_BAD_SCRIPT__ = false;
			window.__ABS_BAD_HANDLER__ = false;
			window.htmx.ajax('GET', ${JSON.stringify(`${PRODUCTION_ORIGIN}/__absolute/native-fragment`)}, {
				target: '#native-fragment-target',
				swap: 'innerHTML'
			});
			return true;
		})()`);
			expect(requested).toBe(true);
			await waitForText('Native fragment safe');
			const boundary = await webview.evaluate<{
				handlerExecuted: boolean;
				safeAction: string | null;
				scriptExecuted: boolean;
				unsafeAction: string | null;
			}>(`(() => ({
			handlerExecuted: window.__ABS_BAD_HANDLER__ === true,
			safeAction: document.querySelector('#safe-fragment-action')?.getAttribute('hx-post') ?? null,
			scriptExecuted: window.__ABS_BAD_SCRIPT__ === true,
			unsafeAction: document.querySelector('#unsafe-fragment-action')?.getAttribute('hx-post') ?? null
		}))()`);
			expect(boundary).toEqual({
				handlerExecuted: false,
				safeAction: `${PRODUCTION_ORIGIN}/htmx/increment`,
				scriptExecuted: false,
				unsafeAction: null
			});
		}
	);
});
