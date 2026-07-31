import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
	createBunStringRawUnicodePlugin,
	rewriteBunStringRawUnicode
} from '../../../src/build/bunStringRawUnicodePlugin';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('Bun String.raw Unicode workaround', () => {
	test('rewrites Unicode raw segments while preserving escapes and substitutions', () => {
		const input =
			'const value = "ok"; export default String.raw`line\\n “ ${value} 👋`;';
		const output = rewriteBunStringRawUnicode(input, 'page.ts');

		expect(output).not.toContain('String.raw`');
		expect(output).toContain('String.raw({ raw: [');
		expect(output).toContain('value');
		expect(output).toContain('line\\\\n');
	});

	test('leaves ASCII-only raw templates alone', () => {
		const input = 'export default String.raw`line\\n`;';

		expect(rewriteBunStringRawUnicode(input)).toBe(input);
	});

	test('keeps target-bun output semantically equal to the source', async () => {
		const root = await mkdtemp(join(tmpdir(), 'absolute-string-raw-'));
		roots.push(root);
		const entrypoint = join(root, 'entry.ts');
		const outdir = join(root, 'build');
		await Bun.write(
			entrypoint,
			'const value = "ok"; export default String.raw`line\\n “ ${value} 👋`;'
		);

		const result = await Bun.build({
			entrypoints: [entrypoint],
			outdir,
			plugins: [createBunStringRawUnicodePlugin()],
			target: 'bun'
		});

		expect(result.success).toBeTrue();
		const output = result.outputs.find((artifact) =>
			artifact.path.endsWith('.js')
		);
		expect(output).toBeDefined();
		if (!output) throw new Error('Bun did not emit a JavaScript artifact');
		const built = await readFile(output.path, 'utf-8');
		expect(built).not.toContain('String.raw`');
		const module = await import(`${output.path}?test=${Date.now()}`);
		expect(module.default).toBe('line\\n “ ok 👋');
	});
});
