import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from '../../../src/core/build';

test('incremental CSS builds refresh entries importing a changed file outside stylesConfig', async () => {
	const root = await mkdtemp(join(process.cwd(), '.css-hmr-test-'));
	const entries = join(root, 'styles/entries');
	const shared = join(root, 'styles/app.css');
	const output = join(root, 'build');
	try {
		await mkdir(entries, { recursive: true });
		await writeFile(join(entries, 'home.css'), '@import "../app.css";');
		await writeFile(shared, '.probe { color: red; }');
		const first = await build({
			buildDirectory: output,
			cwd: root,
			options: { throwOnError: true },
			stylesConfig: entries
		});
		if (!first?.manifest?.HomeCSS)
			throw new Error('Missing initial stylesheet');
		await writeFile(shared, '.probe { color: blue; }');
		const second = await build({
			buildDirectory: output,
			cwd: root,
			incrementalFiles: [shared],
			options: { baseManifest: first.manifest, throwOnError: true },
			stylesConfig: entries
		});
		if (!second?.manifest?.HomeCSS)
			throw new Error('Missing rebuilt stylesheet');
		expect(second.manifest.HomeCSS).not.toBe(first.manifest.HomeCSS);
		const css = await readFile(
			join(output, second.manifest.HomeCSS),
			'utf8'
		);
		expect(css).toContain('#00f');
		expect(css).not.toContain('red');
	} finally {
		await rm(root, { force: true, recursive: true });
	}
}, 30000);
