import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { compileTailwind } from '../../../src/build/compileTailwind';

describe('compileTailwind', () => {
	test('generates Tailwind utilities with Bun native plugin', async () => {
		const root = await mkdtemp(join(process.cwd(), '.tmp-tailwind-bun-'));
		const input = join(root, 'input.css');
		const source = join(root, 'index.html');
		const outDir = join(root, 'build');
		const output = 'styles/tailwind.css';

		try {
			await writeFile(
				input,
				[
					'@import "tailwindcss";',
					`@source "${source.replace(/\\/g, '/')}";`
				].join('\n')
			);
			await writeFile(
				source,
				'<div class="p-4 text-red-500 hover:bg-blue-200"></div>'
			);

			await compileTailwind(input, output, outDir);

			const css = await readFile(join(outDir, output), 'utf-8');
			expect(css).toContain('.p-4');
			expect(css).toContain('.text-red-500');
			expect(css).toContain('.hover\\:bg-blue-200');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	test('runs PostCSS after native Tailwind generation', async () => {
		const root = await mkdtemp(join(process.cwd(), '.tmp-tailwind-postcss-'));
		const input = join(root, 'input.css');
		const source = join(root, 'index.html');
		const outDir = join(root, 'build');
		const output = 'tailwind.css';

		try {
			await writeFile(
				input,
				[
					'@import "tailwindcss";',
					`@source "${source.replace(/\\/g, '/')}";`
				].join('\n')
			);
			await writeFile(source, '<div class="p-4"></div>');

			await compileTailwind(input, output, outDir, {
				postcss: {
					plugins: [
						{
							postcssPlugin: 'absolute-test-tailwind-postcss',
							Once(root) {
								root.append({
									prop: '--absolute-tailwind-postcss',
									value: '1'
								});
							}
						}
					]
				}
			});

			const css = await readFile(join(outDir, output), 'utf-8');
			expect(css).toContain('--absolute-tailwind-postcss: 1');
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
