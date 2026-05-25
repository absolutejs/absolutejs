import { describe, expect, test, afterEach } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { connectHMR, type HMRClient } from '../../../helpers/ws';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';

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
const countButton = resolve(
	PROJECT_ROOT,
	'example/vue/components/CountButton.vue'
);
const useCount = resolve(PROJECT_ROOT, 'example/vue/composables/useCount.ts');

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
	url = '/vue'
) => {
	await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Deep Vue HMR coverage — mirrors the per-feature matrix shipped
 * for Angular. Each test edits one Vue-specific feature and
 * asserts the SSR output reflects the change after the tier-0
 * bundle rebuild.
 *
 * Each test gets its own dev server (same isolation strategy as
 * angular-tiering.test.ts) so the per-file compile cache and the
 * watcher hash table can't bleed across cases. */
describe('Vue deep coverage', () => {
	test('`ref()` initial value change reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c.replace(
				'const count = ref(props.initialCount);',
				'const count = ref(props.initialCount + 999);'
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		// Counter reads from CountButton which gets the count
		// via the @Input. The page passes `count` (now 999)
		// as `initialCount` to <CountButton>. useCount returns
		// 999 → rendered "count is 999".
		expect(html).toContain('count is 999');
	}, 60_000);

	test('`computed()` body change reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c
				.replace(
					"import { ref } from 'vue';",
					"import { ref, computed } from 'vue';"
				)
				.replace(
					'const isOpen = ref(false);',
					'const isOpen = ref(false);\nconst doubled = computed(() => count.value * 17);'
				)
				.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue</h1>\n\t\t<p>DOUBLED_{{ doubled }}</p>'
				)
		);
		const html = await waitForBundleAndFetch(client, srv);
		// initialCount = 0 → count = 0 → doubled = 0
		expect(html).toContain('DOUBLED_0');
	}, 60_000);

	test('`reactive()` object property change reaches SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c
				.replace(
					"import { ref } from 'vue';",
					"import { ref, reactive } from 'vue';"
				)
				.replace(
					'const isOpen = ref(false);',
					"const isOpen = ref(false);\nconst state = reactive({ message: 'REACTIVE_HELLO', mult: 13 });"
				)
				.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue</h1>\n\t\t<p>{{ state.message }}_{{ state.mult }}</p>'
				)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('REACTIVE_HELLO_13');
	}, 60_000);

	test('composable (.ts) body change propagates through to SSR via the importing .vue', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(useCount, (c) =>
			c.replace(
				'const count = ref(initialCount);',
				'const count = ref(initialCount + 555);'
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('count is 555');
	}, 60_000);

	test('composable shape change (new return field) propagates', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(useCount, (c) =>
			c
				.replace(
					'const count = ref(initialCount);',
					'const count = ref(initialCount);\n\tconst label = ref("COMPOSABLE_LABEL");'
				)
				.replace(
					'return {\n\t\tcount,\n\t\tincrement\n\t};',
					'return {\n\t\tcount,\n\t\tincrement,\n\t\tlabel\n\t};'
				)
		);
		mutateFile(countButton, (c) =>
			c
				.replace(
					'const { count, increment } = useCount(props.initialCount);',
					'const { count, increment, label } = useCount(props.initialCount);'
				)
				.replace(
					'<button @click="increment">count is {{ count }}</button>',
					'<button @click="increment">count is {{ count }} ({{ label }})</button>'
				)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('COMPOSABLE_LABEL');
	}, 60_000);

	test('new prop on child component is consumed by parent and rendered', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(countButton, (c) =>
			c
				.replace(
					'const props = defineProps<{ initialCount: number }>();',
					'const props = defineProps<{ initialCount: number; tag?: string }>();'
				)
				.replace(
					'<button @click="increment">count is {{ count }}</button>',
					'<button @click="increment">{{ props.tag ?? "" }} count is {{ count }}</button>'
				)
		);
		mutateFile(vuePage, (c) =>
			c.replace(
				'<CountButton :initialCount="count" />',
				'<CountButton :initialCount="count" tag="NEW_PROP_OK" />'
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('NEW_PROP_OK');
	}, 60_000);

	test('named `<slot>` from a new child component renders parent content', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		const card = resolve(
			PROJECT_ROOT,
			'example/vue/components/SlotCard.vue'
		);
		createFile(
			card,
			`<template>\n\t<div data-slot-card>\n\t\t<slot name="header">FALLBACK_HEADER</slot>\n\t\t<slot>FALLBACK_BODY</slot>\n\t</div>\n</template>\n`
		);
		mutateFile(vuePage, (c) =>
			c
				.replace(
					"import CountButton from '../components/CountButton.vue';",
					"import CountButton from '../components/CountButton.vue';\nimport SlotCard from '../components/SlotCard.vue';"
				)
				.replace(
					'<CountButton :initialCount="count" />',
					'<CountButton :initialCount="count" />\n\t\t<SlotCard>\n\t\t\t<template #header>SLOT_HEADER_OK</template>\n\t\t\t<span>SLOT_BODY_OK</span>\n\t\t</SlotCard>'
				)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('SLOT_HEADER_OK');
		expect(html).toContain('SLOT_BODY_OK');
		expect(html).not.toContain('FALLBACK_HEADER');
	}, 60_000);

	test('`provide`/`inject` flows the value from ancestor to descendant', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c
				.replace(
					"import { ref } from 'vue';",
					"import { ref, provide } from 'vue';"
				)
				.replace(
					'const isOpen = ref(false);',
					"const isOpen = ref(false);\nprovide('themeMessage', 'PROVIDE_INJECT_OK');"
				)
		);
		mutateFile(countButton, (c) =>
			c
				.replace(
					"import { useCount } from '../composables/useCount';",
					"import { useCount } from '../composables/useCount';\nimport { inject } from 'vue';"
				)
				.replace(
					'const { count, increment } = useCount(props.initialCount);',
					"const { count, increment } = useCount(props.initialCount);\nconst themeMessage = inject<string>('themeMessage', 'NO_PROVIDER');"
				)
				.replace(
					'<button @click="increment">count is {{ count }}</button>',
					'<button @click="increment">count is {{ count }} ({{ themeMessage }})</button>'
				)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('PROVIDE_INJECT_OK');
	}, 60_000);

	test('`v-if` directive edit toggles which branch renders', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c.replace(
				'<h1>AbsoluteJS + Vue</h1>',
				'<h1 v-if="true">AbsoluteJS + Vue</h1>\n\t\t<h1 v-else>NEVER_SHOWN</h1>\n\t\t<p v-if="false">HIDDEN_BRANCH</p>\n\t\t<p v-else>VIF_OK</p>'
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('VIF_OK');
		expect(html).not.toContain('HIDDEN_BRANCH');
		expect(html).not.toContain('NEVER_SHOWN');
	}, 60_000);

	test('`v-for` directive renders every iteration', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(vuePage, (c) =>
			c.replace(
				'<h1>AbsoluteJS + Vue</h1>',
				'<h1>AbsoluteJS + Vue</h1>\n\t\t<ul>\n\t\t\t<li v-for="n in [1, 2, 3]" :key="n">VFOR_{{ n }}</li>\n\t\t</ul>'
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		expect(html).toContain('VFOR_1');
		expect(html).toContain('VFOR_2');
		expect(html).toContain('VFOR_3');
	}, 60_000);

	test('`defineExpose` member surfaces no SSR errors when added', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		mutateFile(countButton, (c) =>
			c.replace(
				'const { count, increment } = useCount(props.initialCount);',
				"const { count, increment } = useCount(props.initialCount);\ndefineExpose({ count, increment, marker: 'EXPOSED_OK' });"
			)
		);
		const html = await waitForBundleAndFetch(client, srv);
		// defineExpose doesn't render anything; we just verify
		// SSR didn't crash and the standard button output is
		// still present.
		expect(html).toContain('count is 0');
		// No "EXPOSED_OK" — it's only on the component's public
		// instance API, not the template.
		expect(html).not.toContain('EXPOSED_OK');
	}, 60_000);

	test('scoped `<style scoped>` edit hashes a new data-v attribute into SSR', async () => {
		const srv = await startAndConnect();
		if (!client) throw new Error('client missing');

		// Add a new style rule to the scoped block. The rule
		// should be hashed and appear in the served compiled
		// CSS with the component's `data-v-…` attribute selector.
		mutateFile(countButton, (c) =>
			c.replace(
				'background-color: #1a1a1a;',
				'background-color: #ab3377;'
			)
		);
		await client.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

		const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
		const match = html.match(
			/href="([^"]*vue-example-compiled\.[^"]*\.css)"/
		);
		expect(match?.[1]).toBeTruthy();
		const css = await (await fetch(`${srv.baseUrl}${match![1]}`)).text();
		expect(css).toContain('#ab3377');
		expect(css).toMatch(/\[data-v-/);
	}, 60_000);
});
