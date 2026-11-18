import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { openPage, type BrowserSession } from '../../helpers/browser';
import { fetchPage, waitForServer } from '../../helpers/http';

const FIXTURE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'react-suspense-slot-client'
);
const PORT = 3127;

let proc: ReturnType<typeof Bun.spawn> | undefined;
let session: BrowserSession | undefined;
const baseUrl = `http://localhost:${PORT}`;

afterAll(async () => {
	await session?.close();
	try {
		proc?.kill();
	} catch {
		// ignore
	}
	await proc?.exited;
});

describe('React SuspenseSlot in the browser', () => {
	test('setup: start the fixture server', async () => {
		proc = Bun.spawn(['bun', resolve(FIXTURE, 'server.ts')], {
			cwd: resolve(import.meta.dir, '..', '..', '..'),
			env: {
				...process.env,
				ABSOLUTE_CONFIG: resolve(FIXTURE, 'absolute.config.ts'),
				FORCE_COLOR: '0',
				NODE_ENV: 'development',
				PORT: String(PORT),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		});

		await waitForServer(`${baseUrl}/hmr-status`, 60, 250);
		expect(proc).toBeDefined();
	}, 120_000);

	test('streams the slot in the page tree, with its value, without a collector', async () => {
		const { html, status } = await fetchPage(baseUrl);

		expect(status).toBe(200);
		expect(html).toContain('id="shell"');
		expect(html).toContain('data-absolute-slot-value="slot-count"');
		expect(html).toContain('{"state":"resolved","value":{"start":3}}');
		/* "count" comes from a context above the slot: the content rendered
		 * inside the page's own tree. */
		expect(html).toMatch(/id="counter"[^>]*>count<!-- --> <!-- -->3</u);
	});

	test('takes the streamed slot over: interactive, no hydration error, value handed on', async () => {
		const problems: string[] = [];
		session = await openPage(baseUrl, {
			consoleLog: (message) => {
				if (/hydrat|did not match/iu.test(message))
					problems.push(message);
			}
		});
		const { page } = session;
		await page.waitForSelector('#counter', { timeout: 10_000 });
		expect(await page.textContent('#counter')).toBe('count 3');

		await page.click('#counter');
		await page.waitForFunction(
			() => document.querySelector('#counter')?.textContent === 'count 4'
		);
		expect(
			await page.evaluate(() =>
				(document.body.dataset.resolvedSlots ?? '').split('|')
			)
		).toContain('count:3');
		expect(problems).toEqual([]);
	}, 30_000);

	test('a slot mounted later resolves in the browser', async () => {
		const page = session?.page;
		if (!page) throw new Error('No browser session');
		await page.click('#mount-late');
		await page.waitForSelector('#late-fallback');
		await page.waitForSelector('#late-value', { timeout: 10_000 });

		expect(await page.textContent('#late-value')).toBe(
			'resolved in the browser'
		);
		expect(
			await page.evaluate(() =>
				(document.body.dataset.resolvedSlots ?? '').split('|')
			)
		).toContain('late:resolved in the browser');
	}, 30_000);
});
