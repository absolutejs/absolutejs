import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import {
	openPage,
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

const counter = resolve(
	PROJECT_ROOT,
	'example/svelte/components/Counter.svelte'
);

/* The example's Counter.svelte uses a non-reactive `let count` from
 * a `.svelte.ts` composable that predates Svelte 5's `$state` rune,
 * so clicks don't drive template re-renders. For state-preservation
 * testing we need an actually-reactive counter. Swap Counter.svelte
 * to a runes-mode equivalent at setup time and restore via afterEach. */
const installRuneCounter = () => {
	mutateFile(
		counter,
		() =>
			`<script lang="ts">\n\tlet { initialCount } = $props<{ initialCount: number }>();\n\tlet count = $state(initialCount);\n\tfunction increment() { count = count + 1; }\n</script>\n\n<button onclick={increment}>count is {count}</button>\n\n<style>\n\t@media (prefers-color-scheme: light) {\n\t\tbutton { background-color: #ffffff; }\n\t}\n</style>\n`
	);
};

const startAll = async () => {
	installRuneCounter();
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	session = await openPage(`${server.baseUrl}/svelte`);
	await session.page.waitForFunction(
		() =>
			typeof window !== 'undefined' &&
			(window as { __SVELTE_COMPONENT__?: unknown })
				.__SVELTE_COMPONENT__ !== undefined,
		{ timeout: 15_000 }
	);
	await session.page.waitForSelector('button', { timeout: 15_000 });
	await waitForText(
		session.page,
		'button',
		(t) => /count is \d+/.test(t),
		15_000
	);

	return { client: client, server: server, session: session };
};

/* Svelte 5's HMR runtime preserves state via `$.hmr()` —
 * `collect_state` snapshots reactive values before the swap and
 * `restore_state` applies them on the new component. The counter
 * composable holds a let-binding bumped on click; after a template-
 * only edit, the binding survives.
 *
 * Tier-1 reload (script-shape change that runes can't reconcile)
 * loses state — that's intentional and not tested here. */
describe('Svelte 5 state preservation across template edits', () => {
	test('count survives a template-only edit ($.hmr collect/restore)', async () => {
		const { client: c, session: s } = await startAll();

		for (let i = 0; i < 7; i++) {
			await s.page.click('button');
		}
		await waitForText(s.page, 'button', (t) => t.includes('count is 7'));

		c.drain();
		mutateFile(counter, (text) =>
			text.replace(
				'<button onclick={increment}>count is {count}</button>',
				'<button onclick={increment}>count is {count}</button>\n<span data-test-id="svelte-edited" style="display:none">SVELTE_EDITED</span>'
			)
		);

		await c.waitFor('svelte-update', 15_000);

		// State preservation: after the swap, the displayed
		// count is still 7. Svelte's `$.hmr()` collected the
		// counter's let-binding before swap and restored it.
		const sawSeven = await s.page
			.waitForFunction(
				() => {
					const buttons = document.querySelectorAll('button');
					for (const b of buttons) {
						if (/count is 7\b/.test(b.textContent ?? ''))
							return true;
					}

					return false;
				},
				{ timeout: 15_000 }
			)
			.then(() => true)
			.catch(() => false);
		expect(sawSeven).toBe(true);
	}, 60_000);
});
