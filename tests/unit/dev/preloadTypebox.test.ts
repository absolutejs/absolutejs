import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preloadTypebox } from '../../../src/dev/preloadTypebox';

describe('preloading TypeBox before the parallel runtime import', () => {
	test('loads the copy Elysia will require', async () => {
		expect(await preloadTypebox(process.cwd())).toBe(true);

		// What Elysia's lazy loader does on the first `t.*` call.
		const elysiaRequire = createRequire(
			Bun.resolveSync('elysia', process.cwd())
		);
		const typeNamespace: unknown = elysiaRequire('typebox/type');

		expect(typeNamespace).toHaveProperty('String');
	});

	/* A project without Elysia has no lazy loader and so no race; the boot
	 * must go on rather than fail on a missing module. */
	test('reports false, without throwing, where Elysia cannot be found', async () => {
		const empty = mkdtempSync(join(tmpdir(), 'absolute-no-elysia-'));
		try {
			expect(await preloadTypebox(empty)).toBe(false);
		} finally {
			rmSync(empty, { force: true, recursive: true });
		}
	});
});
