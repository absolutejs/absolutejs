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
			cwd: root,
			buildDirectory: output,
			stylesConfig: entries,
			options: { throwOnError: true }
		});
		if (!first?.manifest?.HomeCSS)
			throw new Error('Missing initial stylesheet');
		await writeFile(shared, '.probe { color: blue; }');
		const second = await build({
			cwd: root,
			buildDirectory: output,
			stylesConfig: entries,
			incrementalFiles: [shared],
			options: { throwOnError: true, baseManifest: first.manifest }
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
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
