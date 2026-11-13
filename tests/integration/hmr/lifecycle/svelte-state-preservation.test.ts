import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';
import {
	openReadyPage,
	type BrowserSession,
	waitForText
} from '../../../helpers/browser';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	if (session) {
		await session.close();
		session = undefined;
	}
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const page = resolve(PROJECT_ROOT, 'example/svelte/pages/SvelteExample.svelte');
const counter = resolve(
	PROJECT_ROOT,
	'example/svelte/components/Counter.svelte'
);
const note = resolve(PROJECT_ROOT, 'example/svelte/components/HmrNote.svelte');

const COUNTER = '[data-test-id="rune-counter"]';
const NOTE = '[data-test-id="hmr-note"]';
const COUNTER_MARKUP =
	'<button data-test-id="rune-counter" onclick={increment}>count is {count}</button>';

/* The page's FIRST button reads "Page 1", the counter lives in its own
 * component, and a sibling component gets edited. beta.168's HMR handler
 * scraped the first number out of the first <button> on every update
 * ("Page 1" → 1), stored it in sessionStorage and remounted the page with
 * `initialCount: 1`, resetting the counter. Svelte's own `$.hmr` swaps only
 * the edited component, so the counter keeps its `$state`. */
const installFixture = () => {
	mutateFile(
		counter,
		() =>
			`<script lang="ts">\n\tlet { initialCount }: { initialCount: number } = $props();\n\tlet count = $state(initialCount);\n\tfunction increment() { count = count + 1; }\n</script>\n\n${COUNTER_MARKUP}\n`
	);
	createFile(note, '<p data-test-id="hmr-note">NOTE_V1</p>\n');
	mutateFile(page, (source) =>
		source
			.replace(
				"import Counter from '../components/Counter.svelte';",
				"import Counter from '../components/Counter.svelte';\n\timport HmrNote from '../components/HmrNote.svelte';"
			)
			.replace(
				'<h1>AbsoluteJS + Svelte</h1>',
				'<button type="button" data-test-id="page-label">Page 1</button>\n\t<h1>AbsoluteJS + Svelte</h1>'
			)
			.replace(
				'<Counter {initialCount} />',
				'<Counter {initialCount} />\n\t<HmrNote />'
			)
	);
};

type HmrSnapshot = {
	firstButton: string;
	initialProps: unknown;
	sessionKeys: string[];
};

const snapshot = (activeSession: BrowserSession) =>
	activeSession.page.evaluate((): HmrSnapshot => ({
		firstButton: document.querySelector('button')?.textContent ?? '',
		initialProps: Reflect.get(window, '__INITIAL_PROPS__'),
		sessionKeys: Object.keys(sessionStorage)
	}));

const startAll = async () => {
	installFixture();
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	session = await openReadyPage(`${server.baseUrl}/svelte`, async (ready) => {
		await ready.waitForFunction(
			() =>
				typeof window !== 'undefined' &&
				(window as { __SVELTE_COMPONENT__?: unknown })
					.__SVELTE_COMPONENT__ !== undefined,
			{ timeout: 15_000 }
		);
		await waitForText(
			ready,
			COUNTER,
			(text) => /count is \d+/.test(text),
			15_000
		);
	});

	return { client, server, session };
};

const clickCounter = async (activeSession: BrowserSession, times: number) => {
	// One browser round trip keeps this reliable under load; separate
	// Playwright clicks each wait for actionability.
	await activeSession.page.locator(COUNTER).evaluate((button, count) => {
		for (let index = 0; index < count; index++) {
			button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		}
	}, times);
	await waitForText(activeSession.page, COUNTER, (text) =>
		text.includes(`count is ${times}`)
	);
};

describe('Svelte HMR keeps state without reading it from the DOM', () => {
	test(
		"a counter's $state survives an edit to a sibling component",
		async () => {
			const { client: hmr, session: activeSession } = await startAll();
			const before = await snapshot(activeSession);
			expect(before.firstButton).toBe('Page 1');

			await clickCounter(activeSession, 3);
			hmr.drain();
			mutateFile(note, (text) => text.replace('NOTE_V1', 'NOTE_V2'));
			await hmr.waitFor('svelte-update', 15_000);
			await waitForText(activeSession.page, NOTE, (text) =>
				text.includes('NOTE_V2')
			);
			// beta.168 followed the note's update with a second one for the
			// page that imports it, which re-created the whole tree. Give a
			// late update time to land before checking the counter.
			await Bun.sleep(1_000);

			const after = await snapshot(activeSession);
			expect(
				await activeSession.page.locator(COUNTER).textContent()
			).toBe('count is 3');
			expect(after.firstButton).toBe('Page 1');
			expect(after.sessionKeys).not.toContain('__SVELTE_HMR_STATE__');
			expect(after.initialProps).toEqual(before.initialProps);
		},
		{ retry: 2, timeout: 60_000 }
	);

	test(
		'an edited component restarts from its real props, not a number scraped from the page',
		async () => {
			const { client: hmr, session: activeSession } = await startAll();
			const before = await snapshot(activeSession);

			await clickCounter(activeSession, 3);
			hmr.drain();
			mutateFile(counter, (text) =>
				text.replace('count is {count}', 'clicked {count}')
			);
			await hmr.waitFor('svelte-update', 15_000);

			// Svelte re-creates the component it swaps, so its own `$state`
			// starts over from `initialCount` (0), never from "Page 1".
			const text = await waitForText(
				activeSession.page,
				COUNTER,
				(seen) => seen.startsWith('clicked')
			);
			expect(text).toBe('clicked 0');
			const after = await snapshot(activeSession);
			expect(after.sessionKeys).not.toContain('__SVELTE_HMR_STATE__');
			expect(after.initialProps).toEqual(before.initialProps);
		},
		{ retry: 2, timeout: 60_000 }
	);
});
