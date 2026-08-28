import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { startDevServer, type DevServer } from '../../helpers/devServer';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CONFIG = resolve(
	PROJECT_ROOT,
	'tests/fixtures/mobile-native-conformance/absolute.config.ts'
);
let server: DevServer | undefined;
let session: BrowserSession | undefined;

const previewFrame = () => {
	const frame = session?.page
		.frames()
		.find((candidate) => candidate !== session?.page.mainFrame());
	if (!frame) throw new Error('Mobile preview iframe is missing.');

	return frame;
};

beforeAll(async () => {
	server = await startDevServer({ configPath: CONFIG });
}, 150_000);

afterAll(async () => {
	await session?.close();
	await server?.kill();
}, 30_000);

describe('first-class mobile preview', () => {
	test('runs the mobile target, controls device state, and enforces offline transport', async () => {
		if (!server) throw new Error('Preview fixture is missing.');
		let lastBrowserError: unknown;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				session = await openPage(
					`${server.baseUrl}/__absolute/mobile-preview`,
					{ viewport: { height: 900, width: 1400 } }
				);
				await session.page.waitForFunction(
					() =>
						document.querySelector('#statusText')?.textContent ===
						'iOS runtime connected',
					undefined,
					{ timeout: 15_000 }
				);
				const { page } = session;
				let frame = previewFrame();
				expect(
					await frame.evaluate(() => window.__ABS_HMR_TARGET__)
				).toBe('mobile-preview');
				expect(
					await frame.evaluate(() =>
						Reflect.has(globalThis, '__ABS_MOBILE_PREVIEW__')
					)
				).toBe(true);

				await page.locator('#offline').click();
				await frame.waitForFunction(async () => {
					const controller = Reflect.get(
						globalThis,
						'__ABS_MOBILE_PREVIEW__'
					);

					return (
						(await controller.adapter.network.getStatus())
							.connected === false
					);
				});
				const offline = await frame.evaluate(async () => {
					const registry = Reflect.get(
						globalThis,
						Symbol.for('@absolutejs/http/runtime')
					);
					const transport = registry.installations.at(-1)?.transport;
					try {
						await transport.fetch(
							new Request(
								`${location.origin}/api/preview-offline`
							)
						);

						return 'connected';
					} catch (error) {
						return error instanceof Error
							? error.message
							: String(error);
					}
				});
				expect(offline).toContain('mobile preview is offline');

				await page.locator('#background').click();
				await frame.waitForFunction(async () => {
					const controller = Reflect.get(
						globalThis,
						'__ABS_MOBILE_PREVIEW__'
					);

					return (
						(await controller.adapter.lifecycle.getState()) ===
						'background'
					);
				});

				await page.locator('#permissionState').selectOption('denied');
				await page.locator('#applyPermission').click();
				await frame.waitForFunction(async () => {
					const controller = Reflect.get(
						globalThis,
						'__ABS_MOBILE_PREVIEW__'
					);

					return (
						(
							await controller.cameraPermission.permission.queryPermission()
						).state === 'denied'
					);
				});

				await page.locator('#android').click();
				await page.waitForFunction(
					() =>
						document.querySelector('#statusText')?.textContent ===
						'Android runtime connected',
					undefined,
					{ timeout: 15_000 }
				);
				frame = previewFrame();
				const platform = await frame.evaluate(async () => {
					const controller = Reflect.get(
						globalThis,
						'__ABS_MOBILE_PREVIEW__'
					);

					return controller.adapter.platform.getInfo();
				});
				expect(platform).toMatchObject({
					isNative: true,
					os: 'android',
					runtime: 'capacitor'
				});

				return;
			} catch (error) {
				lastBrowserError = error;
				await session?.close();
				session = undefined;
				const message =
					error instanceof Error ? error.message : String(error);
				if (
					!/page, context or browser has been closed|target page, context or browser has been closed/iu.test(
						message
					)
				)
					throw error;
				await Bun.sleep(500 * (attempt + 1));
			}
		}
		throw lastBrowserError;
	}, 60_000);
});
