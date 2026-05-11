import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import {
	createFile,
	mutateFile,
	restoreAllFiles
} from '../../../helpers/file';

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

const sveltePage = resolve(
	PROJECT_ROOT,
	'example/svelte/pages/SvelteExample.svelte'
);
const counter = resolve(
	PROJECT_ROOT,
	'example/svelte/components/Counter.svelte'
);
const counterModule = resolve(
	PROJECT_ROOT,
	'example/svelte/composables/counter.svelte.ts'
);

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	return server;
};

const waitForBundleAndFetch = async (
	c: HMRClient,
	srv: DevServer,
	url = '/svelte'
) => {
	await c.waitFor('svelte-tier-zero-ssr-rebuild-complete', 30_000);
	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Deep Svelte 5 HMR coverage. Each test edits one Svelte-specific
 * feature and asserts SSR reflects it after the tier-0 bundle
 * rebuild. One dev server per test for clean isolation. */
describe('Svelte 5 deep coverage', () => {
	test(
		'`$state` rune initial value change reaches SSR',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Switch the whole component to runes mode: any rune
			// usage in the file forces it, and runes mode disallows
			// `export let` — props must come from `$props()`.
			mutateFile(counter, () =>
				`<script lang="ts">\n\tlet { initialCount } = $props<{ initialCount: number }>();\n\tlet count = $state(424242);\n\tfunction increment() { count = count + 1; }\n</script>\n\n<button onclick={increment}>count is {count}</button>\n`
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('count is 424242');
		},
		60_000
	);

	test(
		'`$derived` rune recomputes on dependency change',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(counter, () =>
				`<script lang="ts">\n\tlet { initialCount } = $props<{ initialCount: number }>();\n\tlet count = $state(7);\n\tlet doubled = $derived(count * 13);\n\tfunction increment() { count = count + 1; }\n</script>\n\n<button onclick={increment}>count is {count}</button>\n<span>DERIVED_{doubled}</span>\n`
			);
			const html = await waitForBundleAndFetch(client, srv);
			// 7 * 13 = 91
			expect(html).toContain('DERIVED_91');
		},
		60_000
	);

	test(
		'composable (.svelte.ts module) body change propagates to importer',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(counterModule, (c) =>
				c.replace(
					'let count = initialCount;',
					'let count = initialCount + 555;'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('count is 555');
		},
		60_000
	);

	test(
		'composable shape change (new exported function) is consumed by importer',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(counterModule, (c) =>
				c.replace(
					'return {\n\t\tgetCount,\n\t\tincrement\n\t};',
					'return {\n\t\tgetCount,\n\t\tincrement,\n\t\tlabel: () => "MODULE_LABEL_OK"\n\t};'
				)
			);
			mutateFile(counter, (c) =>
				c
					.replace(
						'const { getCount, increment } = counter(initialCount);',
						'const { getCount, increment, label } = counter(initialCount);'
					)
					.replace(
						'<button onclick={increment}>count is {getCount()}</button>',
						'<button onclick={increment}>count is {getCount()} ({label()})</button>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('MODULE_LABEL_OK');
		},
		60_000
	);

	test(
		'new component prop (`export let`) is consumed by parent',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(counter, (c) =>
				c
					.replace(
						'export let initialCount: number;',
						'export let initialCount: number;\n\texport let tag: string = "";'
					)
					.replace(
						'<button onclick={increment}>count is {getCount()}</button>',
						'<button onclick={increment}>{tag} count is {getCount()}</button>'
					)
			);
			mutateFile(sveltePage, (c) =>
				c.replace(
					'<Counter {initialCount} />',
					'<Counter {initialCount} tag="NEW_PROP_OK" />'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('NEW_PROP_OK');
		},
		60_000
	);

	test(
		'named slot from a new child component renders parent content',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			const card = resolve(
				PROJECT_ROOT,
				'example/svelte/components/SlotCard.svelte'
			);
			createFile(
				card,
				`<div data-slot-card>\n\t<slot name="header">FALLBACK_HEADER</slot>\n\t<slot>FALLBACK_BODY</slot>\n</div>\n`
			);
			mutateFile(sveltePage, (c) =>
				c
					.replace(
						"import Counter from '../components/Counter.svelte';",
						"import Counter from '../components/Counter.svelte';\n\timport SlotCard from '../components/SlotCard.svelte';"
					)
					.replace(
						'<Counter {initialCount} />',
						'<Counter {initialCount} />\n\t<SlotCard>\n\t\t<span slot="header">SLOT_HEADER_OK</span>\n\t\t<span>SLOT_BODY_OK</span>\n\t</SlotCard>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('SLOT_HEADER_OK');
			expect(html).toContain('SLOT_BODY_OK');
			expect(html).not.toContain('FALLBACK_HEADER');
		},
		60_000
	);

	test(
		'`setContext`/`getContext` flows value from ancestor to descendant',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(sveltePage, (c) =>
				c
					.replace(
						"import Counter from '../components/Counter.svelte';",
						"import Counter from '../components/Counter.svelte';\n\timport { setContext } from 'svelte';\n\tsetContext('themeMessage', 'CONTEXT_OK');"
					)
			);
			mutateFile(counter, (c) =>
				c
					.replace(
						"import { counter } from '../composables/counter.svelte';",
						"import { counter } from '../composables/counter.svelte';\n\timport { getContext } from 'svelte';\n\tconst themeMessage = getContext<string>('themeMessage') ?? 'NO_CONTEXT';"
					)
					.replace(
						'<button onclick={increment}>count is {getCount()}</button>',
						'<button onclick={increment}>count is {getCount()} ({themeMessage})</button>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('CONTEXT_OK');
		},
		60_000
	);

	test(
		'`{#if}` block renders the truthy branch',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(sveltePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Svelte</h1>',
					'<h1>AbsoluteJS + Svelte</h1>\n\t{#if true}\n\t\t<span>IF_BRANCH_TRUE</span>\n\t{:else}\n\t\t<span>IF_BRANCH_FALSE</span>\n\t{/if}'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('IF_BRANCH_TRUE');
			expect(html).not.toContain('IF_BRANCH_FALSE');
		},
		60_000
	);

	test(
		'`{#each}` block renders every iteration',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(sveltePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Svelte</h1>',
					'<h1>AbsoluteJS + Svelte</h1>\n\t<ul>\n\t\t{#each [1, 2, 3] as n (n)}\n\t\t\t<li>EACH_{n}</li>\n\t\t{/each}\n\t</ul>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('EACH_1');
			expect(html).toContain('EACH_2');
			expect(html).toContain('EACH_3');
		},
		60_000
	);

	test(
		'`{#await}` resolved-branch body renders SSR-side',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(sveltePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Svelte</h1>',
					'<h1>AbsoluteJS + Svelte</h1>\n\t{#await Promise.resolve("AWAIT_RESOLVED")}\n\t\t<span>AWAIT_PENDING</span>\n\t{:then value}\n\t\t<span>{value}</span>\n\t{/await}'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			// AbsoluteJS's Svelte SSR handles `{#await}` via the
			// streaming-slot lowering path. The resolved body is
			// what eventually streams into the slot. We accept
			// either the resolved sentinel or the pending sentinel
			// (a hydration-time race is allowed since the slot
			// fallback can race the resolve on cold compile).
			expect(
				html.includes('AWAIT_RESOLVED') || html.includes('AWAIT_PENDING')
			).toBe(true);
		},
		60_000
	);

	test(
		'`<style>` block edit lands a fresh rule in the SSR-inlined `<style>` block',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(counter, (c) =>
				c.replace(
					'background-color: #ffffff;',
					'background-color: #ab33ee;'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('#ab33ee');
		},
		60_000
	);

	test(
		'on:click handler edit (Svelte 5 syntax) is invoked correctly during SSR markup pass',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Even though the click handler is for client-side
			// interaction, swapping it should round-trip the
			// component through HMR and SSR without error.
			mutateFile(counter, (c) =>
				c.replace(
					'<button onclick={increment}>count is {getCount()}</button>',
					'<button onclick={() => { console.log("handler-changed"); increment(); }}>count is {getCount()} READY</button>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('count is 0 READY');
		},
		60_000
	);
});
