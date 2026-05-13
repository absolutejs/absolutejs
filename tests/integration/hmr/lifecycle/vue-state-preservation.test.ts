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

const countButton = resolve(
	PROJECT_ROOT,
	'example/vue/components/CountButton.vue'
);

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	session = await openPage(`${server.baseUrl}/vue`);
	// Wait for Vue hydration to mount the counter button. The
	// SSR'd `<button data-v-count-button>count is 0</button>`
	// stays in the DOM during hydration; we wait for the
	// post-hydration interactive state by polling textContent on
	// the page.
	await session.page.waitForSelector('button[data-v-count-button]', {
		timeout: 15_000
	});
	await waitForText(
		session.page,
		'button[data-v-count-button]',
		(t) => /count is \d+/.test(t),
		15_000
	);
	return { client: client!, server: server!, session: session! };
};

/* Vue HMR preserves component-local state via `__VUE_HMR_RUNTIME__`
 * (Vue's official HMR runtime) — `compileVue` injects a
 * `__hmrId` per component and calls `createRecord` so that on
 * subsequent edits, `__VUE_HMR_RUNTIME__.rerender(id, render)` swaps
 * the template render function without destroying the component
 * instance. `ref()` values, `reactive()` proxies, and component
 * setup-scope variables all survive a template-only edit.
 *
 * Script edits force a full reload (state lost — that's intentional;
 * the new setup() body has to run against a fresh closure). We test
 * the template-edit case here. */
describe('Vue state preservation across template edits', () => {
	test('count survives a template-only edit (Vue HMR rerender preserves setup state)', async () => {
		const { client: c, session: s } = await startAll();

		// Click to count=7 — the CountButton uses `useCount()`
		// composable which holds a `ref(initialCount)`. Each
		// click bumps the ref.
		for (let i = 0; i < 7; i++) {
			await s.page.click('button[data-v-count-button]');
		}
		await waitForText(s.page, 'button[data-v-count-button]', (t) =>
			t.includes('count is 7')
		);

		c.drain();
		mutateFile(countButton, (text) =>
			text.replace(
				'<button @click="increment">count is {{ count }}</button>',
				'<button @click="increment">count is {{ count }}</button>\n\t<span data-vue-hmr-marker style="display:none">VUE_EDITED</span>'
			)
		);

		await c.waitFor('vue-update', 15_000);

		// State preservation: after the rerender, the displayed
		// count value should still be 7 (the underlying `ref`
		// from useCount() is preserved across Vue's rerender).
		// We poll the live count in the DOM rather than the
		// button selector — the button can re-render but the
		// `.counter-value`-equivalent text content remains the
		// pre-edit value if state is preserved.
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
