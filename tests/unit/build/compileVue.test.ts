import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compileVue } from '../../../src/build/compileVue';

const writeTempFile = async (path: string, content: string) => {
	await Bun.write(path, content);
};

describe('compileVue', () => {
	test('compiles Vue components referenced only by literal dynamic imports', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'LazyPage.vue');
		const childPath = join(root, 'components', 'LazyPanel.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const LazyPanel = defineAsyncComponent(
  () => import('./components/LazyPanel.vue'),
);
</script>

<template><LazyPanel /></template>`
				),
				writeTempFile(
					childPath,
					'<template><aside>Loaded lazily</aside></template>'
				)
			]);

			const { vueClientPaths, vueServerPaths } = await compileVue(
				[pagePath],
				root,
				false
			);
			const clientEntry = vueClientPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			const serverEntry = vueServerPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			expect(clientEntry).toBeDefined();
			expect(serverEntry).toBeDefined();

			for (const entry of [clientEntry, serverEntry]) {
				if (!entry) continue;
				const entrySource = await Bun.file(entry).text();
				expect(entrySource).toContain(
					'import("./components/LazyPanel.js")'
				);
				expect(
					await Bun.file(
						join(entry, '..', 'components', 'LazyPanel.js')
					).exists()
				).toBe(true);
			}
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('SSR-renders setup state from a dynamically imported Vue component after the production server bundle', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'LazyPage.vue');
		const childPath = join(root, 'components', 'LazyPanel.vue');

		try {
			await Promise.all([
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const LazyPanel = defineAsyncComponent({
  loader: () => import('./components/LazyPanel.vue'),
});
</script>

<template><main><LazyPanel /><footer>complete page</footer></main></template>`
				),
				writeTempFile(
					childPath,
					`<script setup lang="ts">
import { ref } from 'vue';

const selectedIndex = ref<number | null>(null);
const rows = [{ name: 'first row' }];
</script>

<template>
  <section>
    <p>lazy setup rendered</p>
    <dialog v-if="selectedIndex !== null">{{ rows[selectedIndex].name }}</dialog>
  </section>
</template>`
				)
			]);

			const { vueServerPaths } = await compileVue([pagePath], root, false);
			const serverEntry = vueServerPaths.find((path) =>
				path.endsWith('LazyPage.js')
			);
			expect(serverEntry).toBeDefined();
			if (!serverEntry) return;

			const bundled = await Bun.build({
				entrypoints: [serverEntry],
				outdir: join(root, 'bundle'),
				target: 'bun'
			});
			expect(bundled.success).toBe(true);
			const output = bundled.outputs.find((artifact) =>
				artifact.path.endsWith('LazyPage.js')
			);
			expect(output).toBeDefined();
			if (!output) return;

			const pageModule = await import(
				`${pathToFileURL(output.path).href}?test=${Date.now()}`
			);
			const html = await renderToString(createSSRApp(pageModule.default));

			expect(html).toContain('lazy setup rendered');
			expect(html).toContain('<footer>complete page</footer>');
			expect(html).not.toContain('<dialog');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('resolves inherited props from imported TypeScript interfaces', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'ImportedProps.vue');

		try {
			await Promise.all([
				writeTempFile(
					join(root, 'primitiveProps.ts'),
					`export interface PrimitiveProps {
	title: string;
}`
				),
				writeTempFile(
					join(root, 'pageProps.ts'),
					`import type { PrimitiveProps } from './primitiveProps';

export interface PageProps extends PrimitiveProps {
	count?: number;
}`
				),
				writeTempFile(
					pagePath,
					`<script setup lang="ts">
import type { PageProps } from './pageProps';

defineProps<PageProps>();
</script>

<template>
  <h1>{{ title }}</h1>
</template>`
				)
			]);

			const result = await compileVue([pagePath], root, false);

			expect(
				result.vueIndexPaths.some((path) =>
					path.endsWith('ImportedProps.js')
				)
			).toBe(true);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('adds streaming slot hydration pending handling to client bootstrap', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'StreamingPage.vue');

		try {
			await writeTempFile(
				pagePath,
				`<template>
  <main>
    <h1>Vue Stream Test</h1>
  </main>
</template>`
			);

			const { vueIndexPaths } = await compileVue([pagePath], root, false);
			const indexPath = vueIndexPaths.find((path) =>
				path.endsWith('StreamingPage.js')
			);
			expect(indexPath).toBeDefined();

			const indexContent = indexPath
				? await Bun.file(indexPath).text()
				: '';

			expect(indexContent).toContain(
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || hasSpaRoutes || isClientRender);'
			);
			expect(indexContent).toContain(
				'window.__ABSOLUTE_PAGE_DISPOSE__ = async function()'
			);
			expect(indexContent).toContain('window.__ABS_SLOT_HYDRATION_PENDING__ = shouldHydrate;');
			expect(indexContent).toContain(
				'if (shouldHydrate && typeof requestAnimationFrame === "function") {'
			);
			expect(indexContent).toContain('requestAnimationFrame(releaseStreamingSlots);');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('fresh-mounts routed SPA pages instead of hydrating SSR shell', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-vue-'));
		const pagePath = join(root, 'Portal.vue');

		try {
			await writeTempFile(
				pagePath,
				`<script lang="ts">
import { defineRoutes } from '@absolutejs/absolute/vue';

export const routes = defineRoutes([
  { path: '/portal/dashboard', component: () => import('./Dashboard.vue') },
  { path: '/portal/intake', component: () => import('./Intake.vue') },
]);
</script>

<template>
  <RouterView />
</template>`
			);
			await writeTempFile(
				join(root, 'Dashboard.vue'),
				`<template><h1>Dashboard</h1></template>`
			);
			await writeTempFile(
				join(root, 'Intake.vue'),
				`<template><h1>Intake</h1></template>`
			);

			const { vueIndexPaths } = await compileVue([pagePath], root, false);
			const indexPath = vueIndexPaths.find((path) =>
				path.endsWith('Portal.js')
			);
			expect(indexPath).toBeDefined();

			const indexContent = indexPath
				? await Bun.file(indexPath).text()
				: '';

			expect(indexContent).toContain(
				'const hasSpaRoutes = Array.isArray(Reflect.get(PageModule, "routes"));'
			);
			expect(indexContent).toContain(
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || hasSpaRoutes || isClientRender);'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
