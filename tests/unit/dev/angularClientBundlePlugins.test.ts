import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getAngularClientBundlePlugins } from '../../../src/dev/rebuildTrigger';
import type { BuildConfig } from '../../../types/build';

/* A Vue + Angular project has neither React nor Svelte installed. The
 * Angular page index imports `@absolutejs/absolute/client`, whose island
 * hydrators import every framework runtime, so the dev Angular client
 * rebuild failed with "Could not resolve: react / svelte" on every edit.
 * The initial build already stubbed missing frameworks; the Angular dev
 * rebuild now uses the same plugin. */

const config: BuildConfig = {
	angularDirectory: 'angular',
	buildDirectory: 'build',
	vueDirectory: 'vue'
};

let projectRoot = '';
let originalCwd = '';

beforeAll(async () => {
	originalCwd = process.cwd();
	projectRoot = await realpath(
		await mkdtemp(join(tmpdir(), 'absolute-angular-vue-only-'))
	);
	process.chdir(projectRoot);
});

afterAll(async () => {
	process.chdir(originalCwd);
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('Angular dev client rebuild plugins', () => {
	test('stub the runtimes of frameworks the project does not install', async () => {
		const plugins = await getAngularClientBundlePlugins(
			config,
			join(projectRoot, 'angular')
		);

		expect(plugins.map((plugin) => plugin.name)).toContain(
			'absolute-missing-client-frameworks'
		);
	});

	test('bundle an entry that reaches react and svelte without failing', async () => {
		const entry = join(projectRoot, 'entry.js');
		await writeFile(
			entry,
			[
				"export const loadReact = () => import('react-dom/client');",
				"export const loadSvelte = () => import('svelte');",
				"export const loadReactRuntime = () => import('react');"
			].join('\n')
		);
		const result = await Bun.build({
			entrypoints: [entry],
			outdir: join(projectRoot, 'out'),
			plugins: await getAngularClientBundlePlugins(
				config,
				join(projectRoot, 'angular')
			),
			target: 'browser',
			throw: false
		});

		expect(result.logs.map(String).join('\n')).not.toContain(
			'Could not resolve'
		);
		expect(result.success).toBe(true);
	});
});
