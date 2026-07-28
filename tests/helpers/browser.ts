import { chromium, type Browser, type Page } from 'playwright';

export type BrowserSession = {
	browser: Browser;
	page: Page;
	close: () => Promise<void>;
};

type OpenPageOptions = {
	consoleLog?: (message: string) => void;
	viewport?: { height: number; width: number };
};

/* Spin up a headless Chromium against the dev-server URL. The
 * returned page is already navigated to `url` and DOMContentLoaded
 * + the `load` event have fired. `close()` shuts the whole browser
 * down — call from the test's `afterEach` so we don't leak Chromium
 * processes across runs. */
export const openPage = async (
	url: string,
	options: OpenPageOptions = {}
): Promise<BrowserSession> => {
	const browser = await chromium.launch({
		args: ['--no-sandbox', '--disable-dev-shm-usage'],
		headless: true
	});
	const context = await browser.newContext({
		viewport: options.viewport ?? { height: 720, width: 1280 }
	});
	const page = await context.newPage();

	if (options.consoleLog) {
		const { consoleLog } = options;
		page.on('console', (message) => consoleLog(message.text()));
	}

	await page.goto(url, { waitUntil: 'load' });

	return {
		browser,
		page,
		close: async () => {
			try {
				await browser.close();
			} catch {
				/* already closed */
			}
		}
	};
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
