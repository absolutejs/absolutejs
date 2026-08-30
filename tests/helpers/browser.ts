import { chromium, type Browser, type Page } from 'playwright';

export type BrowserSession = {
	browser: Browser;
	page: Page;
	close: () => Promise<void>;
};

type OpenPageOptions = {
	consoleLog?: (message: string) => void;
	viewport?: { height: number; width: number };
	waitUntil?: 'commit' | 'domcontentloaded' | 'load';
};

type ReadyPageOptions = OpenPageOptions & {
	attempts?: number;
	retryDelayMs?: number;
};

const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

const closeBrowser = async (browser: Browser) => {
	await Promise.race([
		browser.close().catch(() => undefined),
		Bun.sleep(BROWSER_CLOSE_TIMEOUT_MS)
	]);
};

/* Spin up a headless Chromium against the dev-server URL. The
 * returned page is already navigated to `url` and DOMContentLoaded
 * + the `load` event have fired. `close()` shuts the whole browser
 * down — call from the test's `afterEach` so we don't leak Chromium
 * processes across runs. */
export const openPage = async (url: string, options: OpenPageOptions = {}) => {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		let browser: Browser | undefined;
		try {
			browser = await chromium.launch({
				args: [
					'--no-sandbox',
					'--disable-dev-shm-usage',
					'--disable-gpu'
				],
				headless: true,
				timeout: 20_000
			});
			const activeBrowser = browser;
			const context = await activeBrowser.newContext({
				viewport: options.viewport ?? { height: 720, width: 1280 }
			});
			const page = await context.newPage();

			if (options.consoleLog) {
				const { consoleLog } = options;
				page.on('console', (message) => consoleLog(message.text()));
			}

			await page.goto(url, {
				waitUntil: options.waitUntil ?? 'load'
			});

			return {
				browser: activeBrowser,
				page,
				close: () => closeBrowser(activeBrowser)
			};
		} catch (error) {
			lastError = error;
			const launchFailed = browser === undefined;
			if (browser) await closeBrowser(browser);
			const message =
				error instanceof Error ? error.message : String(error);
			if (
				!launchFailed &&
				!/browser has been closed|context or browser has been closed|browserType\.launch: Timeout/i.test(
					message
				)
			) {
				throw error;
			}
			await Bun.sleep(100 * (attempt + 1));
		}
	}

	throw lastError;
};

const isClosedBrowserError = (error: unknown) =>
	/browser has been closed|context or browser has been closed|target page, context or browser has been closed/iu.test(
		error instanceof Error ? error.message : String(error)
	);

/**
 * Open a page and prove its framework-specific hydration boundary before handing
 * the session to a test. Long aggregate lanes can have Chromium reclaimed after
 * navigation but before hydration; that is a browser-lifetime failure, not an HMR
 * assertion, so recreate only that session with bounded backoff.
 */
export const openReadyPage = async (
	url: string,
	ready: (page: Page) => Promise<void>,
	options: ReadyPageOptions = {}
) => {
	const attempts = options.attempts ?? 3;
	const retryDelayMs = options.retryDelayMs ?? 500;
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const session = await openPage(url, options);
		try {
			await ready(session.page);
			if (session.page.isClosed() || !session.browser.isConnected()) {
				throw new Error(
					'Target page, context or browser has been closed during readiness.'
				);
			}

			return session;
		} catch (error) {
			lastError = error;
			await session.close();
			if (!isClosedBrowserError(error) || attempt === attempts - 1) {
				throw error;
			}
			await Bun.sleep(retryDelayMs * (attempt + 1));
		}
	}

	throw lastError;
};

/* Wait until `predicate(text)` is true, polling `page.locator(selector).textContent()`.
 * Bounded by `timeoutMs`; throws on timeout with the last-seen text so the
 * failure message tells you exactly what arrived. No fixed-interval polling —
 * playwright's built-in retry runs the predicate on every DOM mutation
 * notification. */
export const waitForText = async (
	page: Page,
	selector: string,
	predicate: (text: string) => boolean,
	timeoutMs = 10_000
) => {
	const locator = page.locator(selector);
	const deadline = Date.now() + timeoutMs;
	let lastSeen = '';
	while (Date.now() < deadline) {
		lastSeen = (await locator.textContent({ timeout: 1000 })) ?? '';
		if (predicate(lastSeen)) return lastSeen;
		try {
			await locator.evaluate(
				() => new Promise((resolve) => setTimeout(resolve, 50))
			);
		} catch {
			/* navigation in flight; retry */
		}
	}
	throw new Error(
		`waitForText timed out after ${timeoutMs}ms. Last seen text for \`${selector}\`: ${JSON.stringify(lastSeen)}`
	);
};
