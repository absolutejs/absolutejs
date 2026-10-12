import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const shim = join(import.meta.dir, '../../../types/style-module-shim.d.ts');

// When two wildcard module declarations match an import, TypeScript uses the
// first one declared, not the most specific. A plain `*.css` above
// `*.module.css` would type every CSS-module class as `any`.
test('stylesheet declarations come after every CSS-module declaration', async () => {
	const lines = (await readFile(shim, 'utf-8')).split('\n');
	const declared = lines
		.map((line, index) => ({
			index,
			pattern: /^declare module '([^']+)'/.exec(line)?.[1]
		}))
		.filter(
			(entry): entry is { index: number; pattern: string } =>
				entry.pattern !== undefined
		);
	const modules = declared.filter(({ pattern }) =>
		pattern.includes('.module.')
	);
	const plain = declared.filter(
		({ pattern }) => !pattern.includes('.module.')
	);

	expect(plain.map(({ pattern }) => pattern)).toContain('*.css');
	const lastModule = Math.max(...modules.map(({ index }) => index));
	for (const { index } of plain) expect(index).toBeGreaterThan(lastModule);
});
