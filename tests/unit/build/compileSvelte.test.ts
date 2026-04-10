import { rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { compileSvelte } from '../../../src/build/compileSvelte';

const writeTempFile = async (path: string, content: string) => {
	await Bun.write(path, content);
};

describe('compileSvelte', () => {
	test('disables hydration for await-based Svelte pages', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolutejs-compile-svelte-'));
		const awaitPage = join(root, 'AwaitStreamingPage.svelte');
		const awaitChild = join(root, 'AwaitChild.svelte');
		const plainPage = join(root, 'PlainPage.svelte');

		try {
			await writeTempFile(
				awaitChild,
				`<script lang="ts">
  const value = new Promise<string>((resolve) => setTimeout(() => resolve('child-loaded'), 1));
</script>
{#await value}
  <p>loading</p>
{:then resolved}
  <p>{resolved}</p>
{/await}`
			);
			await writeTempFile(
				awaitPage,
				`<script lang="ts">
  import AwaitChild from './AwaitChild.svelte';
</script>

<main>
  <AwaitChild />
  <p>await root</p>
</main>`
			);
			await writeTempFile(
				plainPage,
				`<main>
  <p>plain root</p>
</main>`
			);

			const { svelteIndexPaths } = await compileSvelte(
				[awaitPage, plainPage],
				root,
				new Map(),
				false
			);

			const awaitIndexPath = svelteIndexPaths.find((path) =>
				path.endsWith('AwaitStreamingPage.js')
			);
			const plainIndexPath = svelteIndexPaths.find((path) =>
				path.endsWith('PlainPage.js')
			);

			expect(awaitIndexPath).toBeDefined();
			expect(plainIndexPath).toBeDefined();

			const awaitIndex = awaitIndexPath
				? await Bun.file(awaitIndexPath).text()
				: '';
			const plainIndex = plainIndexPath
				? await Bun.file(plainIndexPath).text()
				: '';

			expect(awaitIndex).toContain(
				'var shouldHydrate = typeof window === "undefined" ? false : false;'
			);
			expect(awaitIndex).toContain('} else if (!shouldHydrate) {');
			expect(plainIndex).toContain(
				'var shouldHydrate = typeof window === "undefined" ? false : true;'
			);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
