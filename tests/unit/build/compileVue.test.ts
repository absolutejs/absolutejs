import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { compileVue } from '../../../src/build/compileVue';

const writeTempFile = async (path: string, content: string) => {
	await Bun.write(path, content);
};

describe('compileVue', () => {
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
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || hasSpaRoutes);'
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
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty || hasSpaRoutes);'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
