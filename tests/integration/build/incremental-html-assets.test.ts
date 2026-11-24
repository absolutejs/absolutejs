import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from '../../../src/core/build';
import type { BuildConfig } from '../../../types/build';

test.each(['html', 'htmx'])(
	'unrelated incremental builds retain compiled %s script and style URLs',
	async (framework) => {
		const root = await mkdtemp(
			join(resolve(import.meta.dir, '../../..'), '.html-assets-')
		);
		try {
			const html = join(root, framework);
			const styles = join(root, 'styles');
			await mkdir(join(html, 'pages'), { recursive: true });
			await mkdir(join(html, 'scripts'), { recursive: true });
			await mkdir(styles, { recursive: true });
			await writeFile(
				join(html, 'scripts', 'counter.ts'),
				'document.body.dataset.ready = "yes";'
			);
			await writeFile(join(styles, 'theme.css'), 'body { color: red; }');
			await writeFile(
				join(html, 'pages', 'Home.html'),
				'<html><head><link rel="stylesheet" href="../../styles/theme.css"></head><body><script src="../scripts/counter.ts"></script></body></html>'
			);
			const config: BuildConfig = {
				cwd: root,
				...(framework === 'html'
					? { htmlDirectory: html }
					: { htmxDirectory: html }),
				buildDirectory: join(root, 'build'),
				options: { throwOnError: true },
				stylesConfig: styles
			};
			const initial = await build(config);
			if (!initial?.manifest) throw new Error('Initial build failed');
			const page = initial.manifest.Home;
			if (!page) throw new Error('HTML page missing');
			const before = await readFile(page, 'utf8');
			expect(before).not.toContain('../scripts/counter.ts');
			expect(before).not.toContain('../../styles/theme.css');
			await build({
				...config,
				incrementalFiles: [join(root, 'other-framework.ts')],
				options: { ...config.options, baseManifest: initial.manifest }
			});
			const after = await readFile(page, 'utf8');
			expect(after).toBe(before);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	60000
);
