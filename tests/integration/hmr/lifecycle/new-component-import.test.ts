import { describe, expect, test, afterAll, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

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

/* Creating a brand-new `.svelte` component file at runtime, then
 * editing the page to import + render it, must produce fresh SSR
 * output that includes the component's markup. This exercises the
 * dep-graph add path (file watcher picking up a never-seen file)
 * plus the page's transitive recompile. */
describe('New component file + import in page renders after rebuild', () => {
	test('setup', async () => {
		server = await startDevServer();
		client = await connectHMR(server.port);
		await client.waitFor('manifest');
		await client.waitFor('connected');
		client.drain();
	}, 60_000);

	test('svelte: newly created component is rendered by SSR', async () => {
		const newComponent = resolve(
			PROJECT_ROOT,
			'example/svelte/components/NewBadge.svelte'
		);
		const page = resolve(
			PROJECT_ROOT,
			'example/svelte/pages/SvelteExample.svelte'
		);

		client.drain();
		createFile(
			newComponent,
			`<script lang="ts">
	export let label: string;
</script>

<span data-test-id="new-badge">{label}</span>
`
		);
		mutateFile(page, (c) =>
			c
				.replace(
					"import Counter from '../components/Counter.svelte';",
					"import Counter from '../components/Counter.svelte';\n\timport NewBadge from '../components/NewBadge.svelte';"
				)
				.replace(
					'<Counter {initialCount} />',
					'<Counter {initialCount} />\n\t<NewBadge label="NEW_BADGE_SENTINEL" />'
				)
		);

		await client.waitFor('svelte-tier-zero-ssr-rebuild-complete');
		const html = await (await fetch(`${server.baseUrl}/svelte`)).text();
		expect(html).toContain('data-test-id="new-badge"');
		expect(html).toContain('NEW_BADGE_SENTINEL');
	}, 20_000);
});
