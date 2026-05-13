import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	if (server) {
		await server.kill();
		server = undefined;
	}
	restoreAllFiles();
});

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');

const startAll = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return { client: client!, server: server! };
};

/* Vue pages can export a `setupApp(app, ctx)` hook that the Vue
 * SSR handler awaits before rendering. It receives the Vue
 * application instance plus a context object (`isServer`, `url`,
 * `setRedirect`, optional `router`) — letting the page wire app-
 * level plugins (vue-router, Pinia, etc.) into the request-scoped
 * Vue app.
 *
 * compileVue preserves the `setupApp` export from the page's
 * `<script>` module block (separate from `<script setup>`). The
 * compiled index file pulls it via `Reflect.get(PageModule, 'setupApp')`
 * and awaits it during bootstrap.
 *
 * This test exercises the contract:
 *   1. Adding a `setupApp` export that injects a sentinel into
 *      the app's `provide`/`inject` tree surfaces in the SSR HTML.
 *   2. Editing the `setupApp` body propagates through HMR. */
describe('Vue `setupApp(app, ctx)` page-export hook', () => {
	test('setupApp injection lands in SSR HTML', async () => {
		const { client: c, server: srv } = await startAll();

		// Add a `<script>` module block (separate from <script setup>)
		// that exports `setupApp`. The hook provides a sentinel
		// value at app-level, and the page template reads it via
		// `inject()`.
		mutateFile(vuePage, (text) =>
			text
				.replace(
					'<script setup lang="ts">',
					`<script lang="ts">\nimport type { App } from 'vue';\nexport const setupApp = (app: App) => {\n\tapp.provide('setupAppSentinel', 'SETUP_APP_OK');\n};\n</script>\n<script setup lang="ts">\nimport { inject as inject_ } from 'vue';\nconst setupAppSentinel = inject_<string>('setupAppSentinel') ?? 'NO_SETUP';`
				)
				.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue {{ setupAppSentinel }}</h1>'
				)
		);

		await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);
		const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
		expect(html).toContain('SETUP_APP_OK');
		expect(html).not.toContain('NO_SETUP');
	}, 60_000);

	test('setupApp body edit propagates through HMR', async () => {
		const { client: c, server: srv } = await startAll();

		mutateFile(vuePage, (text) =>
			text
				.replace(
					'<script setup lang="ts">',
					`<script lang="ts">\nimport type { App } from 'vue';\nexport const setupApp = (app: App) => {\n\tapp.provide('setupAppSentinel', 'VERSION_1');\n};\n</script>\n<script setup lang="ts">\nimport { inject as inject_ } from 'vue';\nconst setupAppSentinel = inject_<string>('setupAppSentinel') ?? 'NO_SETUP';`
				)
				.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue {{ setupAppSentinel }}</h1>'
				)
		);
		await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);
		const v1 = await (await fetch(`${srv.baseUrl}/vue`)).text();
		expect(v1).toContain('VERSION_1');

		// Edit the setupApp value.
		c.drain();
		mutateFile(vuePage, (text) =>
			text.replace("'VERSION_1'", "'VERSION_2'")
		);
		// The SSR import cache may need a beat after the bundle
		// rebuild to flip — poll for the new sentinel with a
		// deadline.
		const deadline = Date.now() + 30_000;
		let v2 = '';
		let sawComplete = false;
		while (Date.now() < deadline) {
			if (!sawComplete) {
				try {
					await c.waitFor(
						'vue-tier-zero-ssr-rebuild-complete',
						2_000
					);
					sawComplete = true;
				} catch {
					/* keep polling */
				}
			}
			v2 = await (await fetch(`${srv.baseUrl}/vue`)).text();
			if (v2.includes('VERSION_2')) break;
			await new Promise((r) => setTimeout(r, 250));
		}
		expect(v2).toContain('VERSION_2');
	}, 60_000);
});
