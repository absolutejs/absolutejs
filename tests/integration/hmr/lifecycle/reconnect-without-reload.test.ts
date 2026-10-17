import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
	openReadyPage,
	type BrowserSession,
	waitForText
} from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const PAGE = resolve(PROJECT_ROOT, 'example/html/pages/HTMLExample.html');
const HEADING = 'AbsoluteJS + HTML';
const RECONNECT_TIMEOUT_MS = 15_000;

let server: DevServer | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	await session?.close();
	session = undefined;
	await server?.kill();
	server = undefined;
	restoreAllFiles();
});

type HmrWindow = Window & {
	__HMR_WS__?: WebSocket;
	__reconnectMarker?: number;
};

const open = async () => {
	server = await startDevServer();
	session = await openReadyPage(`${server.baseUrl}/html`, async (page) => {
		await waitForText(page, 'h1', (text) => text.includes(HEADING));
	});
	const { page } = session;
	await page.waitForFunction(
		() => (window as HmrWindow).__HMR_WS__?.readyState === WebSocket.OPEN,
		undefined,
		{ timeout: RECONNECT_TIMEOUT_MS }
	);
	// Survives only if the page is never reloaded.
	await page.evaluate(() => {
		(window as HmrWindow).__reconnectMarker = 1;
	});

	return page;
};

// A dropped connection, as a network change closes it (not a clean close).
const dropSocket = (page: BrowserSession['page']) =>
	page.evaluate(() => (window as HmrWindow).__HMR_WS__?.close(4000, 'drop'));

const waitForReconnect = (page: BrowserSession['page']) =>
	page.waitForFunction(
		() => (window as HmrWindow).__HMR_WS__?.readyState === WebSocket.OPEN,
		undefined,
		{ timeout: RECONNECT_TIMEOUT_MS }
	);

describe('dev client reconnect', () => {
	test('a dropped connection reconnects without reloading, and edits keep applying', async () => {
		const page = await open();
		await dropSocket(page);
		await waitForReconnect(page);
		expect(
			await page.evaluate(() => (window as HmrWindow).__reconnectMarker)
		).toBe(1);

		mutateFile(PAGE, (text) =>
			text.replace(
				`<h1>${HEADING}</h1>`,
				'<h1>AbsoluteJS + HTML, reconnected</h1>'
			)
		);
		await waitForText(page, 'h1', (text) => text.includes('reconnected'));
		expect(
			await page.evaluate(() => (window as HmrWindow).__reconnectMarker)
		).toBe(1);
	}, 90_000);

	test('offline, it waits for the network; an edit made meanwhile reloads the page on return', async () => {
		const page = await open();
		await page.context().setOffline(true);
		await dropSocket(page);
		await page.waitForSelector('#absolutejs-connection-lost');
		expect(await page.textContent('#absolutejs-connection-lost')).toContain(
			'offline'
		);

		mutateFile(PAGE, (text) =>
			text.replace(
				`<h1>${HEADING}</h1>`,
				'<h1>AbsoluteJS + HTML, edited while away</h1>'
			)
		);
		// Let the server build and broadcast the edit to nobody.
		await server?.waitForIdle({ timeoutMs: 30_000 });
		await page.context().setOffline(false);
		await waitForText(
			page,
			'h1',
			(text) => text.includes('edited while away'),
			RECONNECT_TIMEOUT_MS * 2
		);
		expect(
			await page.evaluate(() => (window as HmrWindow).__reconnectMarker)
		).toBeUndefined();
	}, 120_000);
});
