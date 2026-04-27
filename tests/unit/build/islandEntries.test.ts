import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { loadIslandRegistryBuildInfo } from '../../../src/build/islandEntries';
import { loadIslandRegistry } from '../../../src/core/loadIslandRegistry';

const withTempRegistry = async <Result>(
	source: string,
	run: (registryPath: string, sveltePath: string) => Promise<Result>
) => {
	const root = mkdtempSync(join(tmpdir(), 'absolute-islands-'));
	const sveltePath = join(root, 'FieldTimer.svelte');
	const registryPath = join(root, 'islands.ts');

	writeFileSync(
		sveltePath,
		`<script>let active = true;</script>{#if active}<p>Active</p>{/if}`
	);
	writeFileSync(registryPath, source);

	try {
		return await run(registryPath, sveltePath);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
};

describe('loadIslandRegistryBuildInfo', () => {
	test('extracts Svelte island entries without importing raw .svelte files', async () => {
		await withTempRegistry(
			`import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import FieldTimer from './FieldTimer.svelte';

export const islandRegistry = defineIslandRegistry({
	svelte: { FieldTimer }
});
`,
			async (registryPath, sveltePath) => {
				const info = await loadIslandRegistryBuildInfo(registryPath);

				expect(info.hasNamedExport).toBe(true);
				expect(info.definitions).toEqual([
					{
						buildReference: {
							export: 'default',
							source: sveltePath
						},
						component: 'FieldTimer',
						framework: 'svelte'
					}
				]);
			}
		);
	});

	test('recognizes aliased registry helper imports', async () => {
		await withTempRegistry(
			`import { defineIslandRegistry as registry } from '@absolutejs/absolute/islands';
import FieldTimer from './FieldTimer.svelte';

export default registry({
	svelte: { FieldTimer }
});
`,
			async (registryPath, sveltePath) => {
				const info = await loadIslandRegistryBuildInfo(registryPath);

				expect(info.definitions[0]?.buildReference?.source).toBe(
					sveltePath
				);
			}
		);
	});

	test('recognizes namespace registry helper imports', async () => {
		await withTempRegistry(
			`import * as islands from '@absolutejs/absolute/islands';
import FieldTimer from './FieldTimer.svelte';

export default islands.defineIslandRegistry({
	svelte: { FieldTimer }
});
`,
			async (registryPath, sveltePath) => {
				const info = await loadIslandRegistryBuildInfo(registryPath);

				expect(info.definitions[0]?.buildReference?.source).toBe(
					sveltePath
				);
			}
		);
	});
});

describe('loadIslandRegistry', () => {
	test('returns a static registry for Svelte islands without executing the registry module', async () => {
		await withTempRegistry(
			`import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import FieldTimer from './FieldTimer.svelte';

export default defineIslandRegistry({
	svelte: { FieldTimer }
});
`,
			async (registryPath, sveltePath) => {
				const registry = await loadIslandRegistry(registryPath);

				expect(registry.svelte?.FieldTimer).toEqual({
					component: sveltePath,
					export: 'default',
					source: sveltePath
				});
			}
		);
	});
});
