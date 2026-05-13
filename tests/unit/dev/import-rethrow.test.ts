import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Regression for oven-sh/bun#29791 (fixed in 1.3.14 via PR #29393).
 *
 * Background: when `await import(path)` evaluated a module whose
 * top-level threw, the first import correctly rejected, but a second
 * sequential `import()` of the same path silently returned a
 * partially-initialized module record (`default: undefined`) instead
 * of re-throwing. AbsoluteJS shipped detectExportedComponentClass in
 * compileAngular.ts to dodge the trigger; this test guards against
 * a future regression of the loader fix itself. If this fails, a
 * dangling-reference bundle emit reverts to "first-hit flaky, retries
 * pass" mode and is easy to misdiagnose as an HMR race. */
test('sequential import() of a throwing module rejects with the same error every time', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'import-rethrow-'));

	try {
		const thrower = join(dir, 'thrower.ts');

		await writeFile(
			thrower,
			"throw new Error('boom');\nexport const x = 1;\n"
		);

		const messages: string[] = [];

		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await import(thrower);
				messages.push(`call ${attempt}: did not throw`);
			} catch (err) {
				messages.push((err as Error).message);
			}
		}

		expect(messages).toEqual(['boom', 'boom']);
	} finally {
		await rm(dir, { force: true, recursive: true });
	}
});
