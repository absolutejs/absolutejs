import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

const projectRoot = resolve(import.meta.dir, '..', '..', '..');

describe('repository ESLint configuration', () => {
	test('ignores disposable sharded test worktrees', async () => {
		const eslint = new ESLint({
			cwd: projectRoot,
			overrideConfigFile: resolve(projectRoot, 'eslint.config.mjs')
		});

		expect(
			await eslint.isPathIgnored(
				resolve(projectRoot, '.test-shards/shard-0/src/example.ts')
			)
		).toBeTrue();
		expect(
			await eslint.isPathIgnored(
				resolve(projectRoot, '.agents/runtime/generated.ts')
			)
		).toBeTrue();
		expect(
			await eslint.isPathIgnored(
				resolve(projectRoot, '.codex/runtime/generated.ts')
			)
		).toBeTrue();
		expect(
			await eslint.isPathIgnored(resolve(projectRoot, 'src/index.ts'))
		).toBeFalse();
	});
});
