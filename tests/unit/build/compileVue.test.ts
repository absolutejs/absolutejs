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
				'const shouldHydrate = typeof window === "undefined" ? false : !(isHMR || isSsrDirty);'
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
});
