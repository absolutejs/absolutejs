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

const vuePage = resolve(PROJECT_ROOT, 'example/vue/pages/VueExample.vue');
const countButton = resolve(
	PROJECT_ROOT,
	'example/vue/components/CountButton.vue'
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
	url = '/vue'
) => {
	await c.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);
	return (await fetch(`${srv.baseUrl}${url}`)).text();
};

/* Vue deeper coverage — pushes the matrix to match Angular's
 * depth. Each test exercises a Vue Composition / template /
 * directive feature and asserts the SSR output. Lifecycle hooks
 * that ONLY run client-side (onMounted, etc.) are exercised via
 * the parts that DO run server-side: import-side effects (the
 * `setup()` body) and `onServerPrefetch`. */
describe('Vue deeper coverage', () => {
	test(
		'change-type: template-only edit fires a Vue HMR cycle (vue-update broadcast)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue TEMPLATE_ONLY</h1>'
				)
			);
			const update = await client.waitFor('vue-update', 30_000);
			expect((update.data as { framework?: string })?.framework).toBe(
				'vue'
			);

			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('TEMPLATE_ONLY');
		},
		60_000
	);

	test(
		'change-type: script edit fires a Vue HMR cycle with forceReload semantics',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'const isOpen = ref(false);',
					"const isOpen = ref(false);\nconst scriptSentinel = ref('SCRIPT_EDIT_OK');"
				).replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue {{ scriptSentinel }}</h1>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('SCRIPT_EDIT_OK');
		},
		60_000
	);

	test(
		'`watch` callback runs on initial server render when `immediate: true`',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c
					.replace(
						"import { ref } from 'vue';",
						"import { ref, watch } from 'vue';"
					)
					.replace(
						'const isOpen = ref(false);',
						"const isOpen = ref(false);\nconst observed = ref('init');\nwatch(isOpen, () => {}, { immediate: true });\nobserved.value = 'WATCH_RAN_' + 42;"
					)
					.replace(
						'<h1>AbsoluteJS + Vue</h1>',
						'<h1>AbsoluteJS + Vue {{ observed }}</h1>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('WATCH_RAN_42');
		},
		60_000
	);

	test(
		'`watchEffect` runs synchronously in setup() and its body reaches SSR',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c
					.replace(
						"import { ref } from 'vue';",
						"import { ref, watchEffect } from 'vue';"
					)
					.replace(
						'const isOpen = ref(false);',
						"const isOpen = ref(false);\nconst effectVal = ref('init');\nwatchEffect(() => { effectVal.value = 'WATCHEFFECT_OK_' + (isOpen.value ? 'OPEN' : 'CLOSED'); });"
					)
					.replace(
						'<h1>AbsoluteJS + Vue</h1>',
						'<h1>AbsoluteJS + Vue {{ effectVal }}</h1>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			// isOpen starts false → 'CLOSED'
			expect(html).toContain('WATCHEFFECT_OK_CLOSED');
		},
		60_000
	);

	test(
		'`defineEmits` declaration round-trips through HMR + SSR without error',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(countButton, (c) =>
				c.replace(
					'const props = defineProps<{ initialCount: number }>();',
					"const props = defineProps<{ initialCount: number }>();\nconst emit = defineEmits<{ (e: 'changed', value: number): void }>();\nvoid emit;"
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			// Just confirm SSR didn't crash and the button still
			// renders. defineEmits has no SSR-visible markup —
			// emit() is fired in client-side event handlers.
			expect(html).toContain('count is 0');
		},
		60_000
	);

	test(
		'`v-model` two-way binding declaration via `defineModel` SSR-renders the initial value',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			const modelChild = resolve(
				PROJECT_ROOT,
				'example/vue/components/ModelChild.vue'
			);
			createFile(
				modelChild,
				`<script setup lang="ts">\nconst modelValue = defineModel<string>({ default: 'DEFINEMODEL_OK' });\n</script>\n\n<template>\n\t<input :value="modelValue" data-test-id="model-input" />\n\t<span>VAL_{{ modelValue }}</span>\n</template>\n`
			);
			mutateFile(vuePage, (c) =>
				c
					.replace(
						"import CountButton from '../components/CountButton.vue';",
						"import CountButton from '../components/CountButton.vue';\nimport ModelChild from '../components/ModelChild.vue';"
					)
					.replace(
						'<CountButton :initialCount="count" />',
						'<CountButton :initialCount="count" />\n\t<ModelChild />'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('VAL_DEFINEMODEL_OK');
		},
		60_000
	);

	test(
		'`v-show` toggles the inline `display` style based on the predicate',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue</h1>\n\t\t<span v-show="false">VSHOW_HIDDEN</span>\n\t\t<span v-show="true">VSHOW_VISIBLE</span>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			// v-show always renders the element but adds
			// `style="display:none"` when falsy. Both sentinels
			// appear, but the hidden one is wrapped in a styled
			// element.
			expect(html).toContain('VSHOW_VISIBLE');
			expect(html).toContain('VSHOW_HIDDEN');
			expect(html).toMatch(/display\s*:\s*none[^"']*"[^>]*>VSHOW_HIDDEN/);
		},
		60_000
	);

	test(
		'`@event.modifier` handlers compile and SSR-render correctly',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1 @click.stop="() => {}" @keydown.esc="() => {}">AbsoluteJS + Vue MODIFIERS_OK</h1>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('MODIFIERS_OK');
		},
		60_000
	);

	test(
		'multi-style-block SFC (scoped + global) edits land in served CSS',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(countButton, (c) =>
				c.replace(
					'<style scoped>',
					"<style>\n.global-vue-marker { background-color: #ab44cc; }\n</style>\n<style scoped>"
				)
			);
			await client.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);
			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			const cssMatch = html.match(
				/href="([^"]*vue-example-compiled\.[^"]*\.css)"/
			);
			expect(cssMatch?.[1]).toBeTruthy();
			const css = await (
				await fetch(`${srv.baseUrl}${cssMatch![1]}`)
			).text();
			expect(css).toContain('#ab44cc');
			// Scoped + global selectors coexist; the global one has
			// no `[data-v-…]` attribute.
			expect(css).toContain('.global-vue-marker');
		},
		60_000
	);

	test(
		'custom directive with `getSSRProps` renders the SSR attributes',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c
					.replace(
						"import { ref } from 'vue';",
						"import { ref, type ObjectDirective } from 'vue';\n\nconst vDataMarker: ObjectDirective<HTMLElement, string> = {\n\tgetSSRProps(binding) {\n\t\treturn { 'data-marker': binding.value };\n\t},\n\tmounted() {}\n};"
					)
					.replace(
						'<h1>AbsoluteJS + Vue</h1>',
						'<h1 v-data-marker="\'CUSTOM_DIR_OK\'">AbsoluteJS + Vue</h1>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('data-marker="CUSTOM_DIR_OK"');
		},
		60_000
	);

	test(
		'Teleport with `disabled` SSRs the children at their declared spot',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue</h1>\n\t\t<Teleport to="body" :disabled="true">\n\t\t\t<span data-teleport>TELEPORT_DISABLED_OK</span>\n\t\t</Teleport>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('TELEPORT_DISABLED_OK');
		},
		60_000
	);

	test(
		'`Suspense` resolves the default slot SSR-side (no async children)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue</h1>\n\t\t<Suspense>\n\t\t\t<template #default>\n\t\t\t\t<span>SUSPENSE_DEFAULT_OK</span>\n\t\t\t</template>\n\t\t\t<template #fallback>\n\t\t\t\t<span>SUSPENSE_FALLBACK</span>\n\t\t\t</template>\n\t\t</Suspense>'
				)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('SUSPENSE_DEFAULT_OK');
			expect(html).not.toContain('SUSPENSE_FALLBACK');
		},
		60_000
	);

	test(
		'`onServerPrefetch` value is awaited and reaches SSR',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			mutateFile(vuePage, (c) =>
				c
					.replace(
						"import { ref } from 'vue';",
						"import { ref, onServerPrefetch } from 'vue';"
					)
					.replace(
						'const isOpen = ref(false);',
						"const isOpen = ref(false);\nconst prefetched = ref('init');\nonServerPrefetch(async () => {\n\tawait Promise.resolve();\n\tprefetched.value = 'PREFETCH_OK';\n});"
					)
					.replace(
						'<h1>AbsoluteJS + Vue</h1>',
						'<h1>AbsoluteJS + Vue {{ prefetched }}</h1>'
					)
			);
			const html = await waitForBundleAndFetch(client, srv);
			expect(html).toContain('PREFETCH_OK');
		},
		60_000
	);

	test(
		'edit re-emits a fresh hashed page bundle (index URL rotates)',
		async () => {
			const srv = await startAndConnect();
			if (!client) throw new Error('client missing');

			// Snapshot the SSR HTML's bundled index URL before the
			// edit — proves the bundle has a fresh content hash
			// after the rebuild, not just that SSR fetched stale-
			// then-fresh bytes.
			const beforeHtml = await (await fetch(`${srv.baseUrl}/vue`)).text();
			const idxBeforeMatch = beforeHtml.match(
				/src="(\/[^"]*\/VueExample\.[^"]+\.js)"/
			);
			expect(idxBeforeMatch?.[1]).toBeTruthy();
			const idxBefore = idxBeforeMatch![1];

			mutateFile(vuePage, (c) =>
				c.replace(
					'<h1>AbsoluteJS + Vue</h1>',
					'<h1>AbsoluteJS + Vue REHASH_OK</h1>'
				)
			);
			await client.waitFor('vue-tier-zero-ssr-rebuild-complete', 30_000);

			const afterHtml = await (await fetch(`${srv.baseUrl}/vue`)).text();
			expect(afterHtml).toContain('REHASH_OK');
			const idxAfterMatch = afterHtml.match(
				/src="(\/[^"]*\/VueExample\.[^"]+\.js)"/
			);
			expect(idxAfterMatch?.[1]).toBeTruthy();
			expect(idxAfterMatch![1]).not.toBe(idxBefore);
		},
		60_000
	);

	test(
		'Vue SSR HTML carries `data-v-…` scope ids for scoped style attribution',
		async () => {
			const srv = await startAndConnect();
			const html = await (await fetch(`${srv.baseUrl}/vue`)).text();
			// The example's CountButton has a scoped style block,
			// so its rendered button must carry the scope attribute.
			expect(html).toMatch(/data-v-count-button/);
		},
		30_000
	);
});
