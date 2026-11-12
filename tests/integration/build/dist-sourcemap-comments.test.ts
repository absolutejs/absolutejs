import { beforeAll, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `absolute start` printed "Could not decode sourcemap in dist/server.js"
 * on the first error. The production server bundle has no source map, but
 * the AbsoluteJS code inside it built inline source map comments from
 * template literals starting with `\n`, which Bun's bundler emits as a real
 * newline. The result was a line beginning
 * `//# sourceMappingURL=data:application/json;base64,${…}` in the middle of
 * the bundle; Bun takes such a line for the file's own source map when it
 * builds a stack trace and fails to decode it.
 *
 * dist/ is bundled into every consumer's server, so no dist module may
 * contain a line that starts an inline source map comment. */

const distRoot = resolve(import.meta.dir, '..', '..', '..', 'dist');
const INLINE_MAP_LINE = /^\/\/# sourceMappingURL=data:/m;

beforeAll(async () => {
	await ensureDistBuild();
}, 600_000);

test('no dist module has a line that starts an inline source map comment', async () => {
	const files = await Array.fromAsync(
		new Bun.Glob('**/*.js').scan({ cwd: distRoot })
	);
	const offenders: string[] = [];
	await Promise.all(
		files.map(async (file) => {
			const source = await readFile(join(distRoot, file), 'utf8');
			if (INLINE_MAP_LINE.test(source)) offenders.push(file);
		})
	);

	expect(files.length).toBeGreaterThan(0);
	expect(offenders.sort()).toEqual([]);
});
