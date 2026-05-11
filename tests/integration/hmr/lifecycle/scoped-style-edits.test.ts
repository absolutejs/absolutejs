import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

let server: DevServer;
let client: HMRClient;

afterEach(() => {
	restoreAllFiles();
});

afterAll(async () => {
	client?.close();
	await server?.kill();
});

/* Scoped style edits (`<style scoped>` for Vue, plain `<style>` for
 * Svelte 5 — both compile to a scope-id selector at the compiler
 * level) must reach SSR so a fresh fetch shows the new bytes. The
 * tier-0 fast path patches the running session's CSS module but
 * the on-disk server bundle's inlined styles stay frozen unless
 * the rebuild scheduler picks them up. We assert the new declared
 * color lands in the SSR HTML's inlined style block. */
describe('Scoped style block edits propagate to SSR', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test(
		'vue scoped style edit lands in SSR HTML',
		async () => {
			const sfc = resolve(
				PROJECT_ROOT,
				'example/vue/components/CountButton.vue'
			);

			client.drain();
			mutateFile(sfc, (c) =>
				c.replace('background-color: #1a1a1a;', 'background-color: #ff0aee;')
			);

			await client.waitFor('vue-tier-zero-ssr-rebuild-complete');
			// Compiled CSS is loaded via the manifest-served stylesheet,
			// not inlined into the HTML body. Fetch the linked stylesheet
			// and confirm the new color is present.
			const html = await (await fetch(`${server.baseUrl}/vue`)).text();
			const match = html.match(
				/href="([^"]*vue-example-compiled\.[^"]*\.css)"/
			);
			expect(match?.[1]).toBeTruthy();
			const css = await (
				await fetch(`${server.baseUrl}${match![1]}`)
			).text();
			expect(css).toContain('#ff0aee');
		},
		15_000
	);

	test(
		'svelte scoped style edit lands in SSR HTML',
		async () => {
			const sfc = resolve(
				PROJECT_ROOT,
				'example/svelte/components/Counter.svelte'
			);

			client.drain();
			mutateFile(sfc, (c) =>
				c.replace('background-color: #ffffff;', 'background-color: #ff0aee;')
			);

			await client.waitFor('svelte-tier-zero-ssr-rebuild-complete');
			// Svelte inlines scoped styles into a `<style id="svelte-...">`
			// element in the SSR'd <head>, so we assert directly on the
			// page HTML.
			const html = await (await fetch(`${server.baseUrl}/svelte`)).text();
			expect(html).toContain('#ff0aee');
		},
		15_000
	);
});
