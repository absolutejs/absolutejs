import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getAvailablePort } from '../../helpers/ports';
import { waitForServer, fetchPage } from '../../helpers/http';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');

type Spawned = {
	port: number;
	baseUrl: string;
	proc: ReturnType<typeof Bun.spawn>;
	cwd: string;
	outdir: string;
	kill: () => Promise<void>;
};

const startMinimalProd = async (
	frameworkSetup: (cwd: string) => Promise<{
		serverEntryPath: string;
		configPath: string;
	}>
): Promise<Spawned> => {
	// Stage under PROJECT_ROOT/.test-builds so `validateSafePath`
	// (which rejects anything not under cwd) accepts the framework
	// dirs we generate. The dir is gitignored via `.test-*` glob.
	const stagingRoot = resolve(PROJECT_ROOT, '.test-builds');
	await mkdir(stagingRoot, { recursive: true });
	const cwd = await mkdtemp(join(stagingRoot, 'partial-'));
	const { serverEntryPath, configPath } = await frameworkSetup(cwd);
	const outdir = join(cwd, 'dist');
	await mkdir(outdir, { recursive: true });
	const port = await getAvailablePort();

	// Run from PROJECT_ROOT so Bun's resolver finds vue, svelte,
	// @angular/* in the main project's node_modules. The user's
	// real workflow is identical — they install their framework
	// deps in their project tree, not in a sandbox we create per
	// test. We just point the build at the synthetic config +
	// server entry, and the framework-dir paths in the config
	// (relative to cwd) land inside our temp project.
	const proc = Bun.spawn(
		[
			'bun',
			'run',
			resolve(PROJECT_ROOT, 'src/cli/index.ts'),
			'start',
			serverEntryPath,
			'--outdir',
			outdir,
			'--config',
			configPath
		],
		{
			cwd: PROJECT_ROOT,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NODE_ENV: 'production',
				PORT: String(port),
				TELEMETRY_OFF: '1'
			},
			stderr: 'pipe',
			stdout: 'pipe'
		}
	);

	const baseUrl = `http://localhost:${port}`;
	try {
		await waitForServer(baseUrl, 120);
	} catch (err) {
		try {
			proc.kill();
		} catch {
			/* */
		}
		const stderr = proc.stderr
			? await new Response(proc.stderr as ReadableStream).text()
			: '';
		await rm(cwd, { force: true, recursive: true }).catch(() => {});
		throw new Error(
			`Prod boot failed for partial-framework setup on port ${port}: ${err}\n` +
				`stderr:\n${stderr.slice(0, 2000)}`,
			{ cause: err }
		);
	}

	const kill = async () => {
		try {
			proc.kill();
		} catch {
			/* */
		}
		await proc.exited;
		await rm(cwd, { force: true, recursive: true }).catch(() => {});
	};

	return { baseUrl, cwd, kill, outdir, port, proc };
};

let activeServers: Spawned[] = [];
afterAll(async () => {
	for (const s of activeServers) await s.kill().catch(() => {});
});

/* `absolute.config.ts` lets users opt in to any subset of supported
 * frameworks. The shipped `example/` exercises all 6; the prod
 * build/start path has historically been tuned against that
 * "everything enabled" shape, and per-framework guards (e.g. "skip
 * Angular vendor build if no Angular dir") have to actually fire
 * to avoid pulling unrelated framework code into a minimal project's
 * bundle.
 *
 * This test stands up minimal synthetic projects per framework and
 * verifies the full build + serve loop. If a code path assumes
 * "every framework dir is set" — e.g. unconditional Angular AOT
 * compile, eager React import — it'd fail here loudly. */
describe('production build + start against a partial framework config', () => {
	test('Vue-only — build succeeds, page renders', async () => {
		const server = await startMinimalProd(async (cwd) => {
			await mkdir(join(cwd, 'vue', 'pages'), { recursive: true });
			await writeFile(
				join(cwd, 'vue', 'pages', 'Home.vue'),
				`<template>
	<main>
		<h1>VueOnlyHomePage</h1>
		<p data-marker="vue-only">{{ greeting }}</p>
	</main>
</template>

<script setup lang="ts">
const greeting = 'hello from vue-only';
</script>
`
			);
			const configPath = join(cwd, 'absolute.config.ts');
			const cwdNorm = cwd.replace(/\\/g, '/');
			await writeFile(
				configPath,
				`import { defineConfig } from '${resolve(
					PROJECT_ROOT,
					'src/utils/defineConfig'
				).replace(/\\/g, '/')}';\n` +
					`export default defineConfig({\n` +
					`\tbuildDirectory: '${cwdNorm}/dist',\n` +
					`\tvueDirectory: '${cwdNorm}/vue'\n` +
					`});\n`
			);
			const serverEntryPath = join(cwd, 'server.ts');
			const srcRoot = resolve(PROJECT_ROOT, 'src').replace(/\\/g, '/');
			await writeFile(
				serverEntryPath,
				`import { Elysia } from 'elysia';\n` +
					`import { asset, prepare } from '${srcRoot}/index';\n` +
					`import { handleVuePageRequest } from '${srcRoot}/vue';\n` +
					`import { networking } from '${srcRoot}/plugins/networking';\n\n` +
					`const { absolutejs, manifest } = await prepare();\n\n` +
					`new Elysia()\n` +
					`\t.use(absolutejs)\n` +
					`\t.get('/', () =>\n` +
					`\t\thandleVuePageRequest({\n` +
					`\t\t\tcssPaths: [],\n` +
					`\t\t\tindexPath: asset(manifest, 'HomeIndex'),\n` +
					`\t\t\tpagePath: asset(manifest, 'Home'),\n` +
					`\t\t\tprops: {}\n` +
					`\t\t})\n` +
					`\t)\n` +
					`\t.use(networking);\n`
			);
			return { configPath, serverEntryPath };
		});
		activeServers.push(server);

		const { html, status } = await fetchPage(server.baseUrl);
		expect(status).toBe(200);
		expect(html).toContain('VueOnlyHomePage');
		expect(html).toContain('hello from vue-only');
		expect(html).not.toMatch(/Server Render Error/);
	}, 180_000);

	test('Svelte-only — build succeeds, page renders', async () => {
		const server = await startMinimalProd(async (cwd) => {
			await mkdir(join(cwd, 'svelte', 'pages'), { recursive: true });
			await writeFile(
				join(cwd, 'svelte', 'pages', 'Home.svelte'),
				`<script>
	let greeting = 'hello from svelte-only';
</script>

<main>
	<h1>SvelteOnlyHomePage</h1>
	<p data-marker="svelte-only">{greeting}</p>
</main>
`
			);
			const configPath = join(cwd, 'absolute.config.ts');
			const cwdNorm = cwd.replace(/\\/g, '/');
			await writeFile(
				configPath,
				`import { defineConfig } from '${resolve(
					PROJECT_ROOT,
					'src/utils/defineConfig'
				).replace(/\\/g, '/')}';\n` +
					`export default defineConfig({\n` +
					`\tbuildDirectory: '${cwdNorm}/dist',\n` +
					`\tsvelteDirectory: '${cwdNorm}/svelte'\n` +
					`});\n`
			);
			const srcRoot = resolve(PROJECT_ROOT, 'src').replace(/\\/g, '/');
			const serverEntryPath = join(cwd, 'server.ts');
			await writeFile(
				serverEntryPath,
				`import { Elysia } from 'elysia';\n` +
					`import { asset, prepare } from '${srcRoot}/index';\n` +
					`import { handleSveltePageRequest } from '${srcRoot}/svelte';\n` +
					`import { networking } from '${srcRoot}/plugins/networking';\n\n` +
					`const { absolutejs, manifest } = await prepare();\n\n` +
					`new Elysia()\n` +
					`\t.use(absolutejs)\n` +
					`\t.get('/', () =>\n` +
					`\t\thandleSveltePageRequest({\n` +
					`\t\t\tcssPaths: [],\n` +
					`\t\t\tindexPath: asset(manifest, 'HomeIndex'),\n` +
					`\t\t\tpagePath: asset(manifest, 'Home'),\n` +
					`\t\t\tprops: {}\n` +
					`\t\t})\n` +
					`\t)\n` +
					`\t.use(networking);\n`
			);
			return { configPath, serverEntryPath };
		});
		activeServers.push(server);

		const { html, status } = await fetchPage(server.baseUrl);
		expect(status).toBe(200);
		expect(html).toContain('SvelteOnlyHomePage');
		expect(html).toContain('hello from svelte-only');
		expect(html).not.toMatch(/Server Render Error/);
	}, 180_000);

	test('HTML-only — static page builds + serves', async () => {
		const server = await startMinimalProd(async (cwd) => {
			await mkdir(join(cwd, 'html', 'pages'), { recursive: true });
			await writeFile(
				join(cwd, 'html', 'pages', 'Home.html'),
				`<!DOCTYPE html>
<html>
<head><title>HTMLOnlyTitle</title></head>
<body>
<h1>HTMLOnlyHomePage</h1>
<p data-marker="html-only">hello from html-only</p>
</body>
</html>
`
			);
			const configPath = join(cwd, 'absolute.config.ts');
			const cwdNorm = cwd.replace(/\\/g, '/');
			await writeFile(
				configPath,
				`import { defineConfig } from '${resolve(
					PROJECT_ROOT,
					'src/utils/defineConfig'
				).replace(/\\/g, '/')}';\n` +
					`export default defineConfig({\n` +
					`\tbuildDirectory: '${cwdNorm}/dist',\n` +
					`\thtmlDirectory: '${cwdNorm}/html'\n` +
					`});\n`
			);
			const srcRoot = resolve(PROJECT_ROOT, 'src').replace(/\\/g, '/');
			const serverEntryPath = join(cwd, 'server.ts');
			await writeFile(
				serverEntryPath,
				`import { Elysia } from 'elysia';\n` +
					`import { asset, handleHTMLPageRequest, prepare } from '${srcRoot}/index';\n` +
					`import { networking } from '${srcRoot}/plugins/networking';\n\n` +
					`const { absolutejs, manifest } = await prepare();\n\n` +
					`new Elysia()\n` +
					`\t.use(absolutejs)\n` +
					`\t.get('/', () => handleHTMLPageRequest(asset(manifest, 'Home')))\n` +
					`\t.use(networking);\n`
			);
			return { configPath, serverEntryPath };
		});
		activeServers.push(server);

		const { html, status } = await fetchPage(server.baseUrl);
		expect(status).toBe(200);
		expect(html).toContain('HTMLOnlyHomePage');
		expect(html).toContain('hello from html-only');
	}, 180_000);
});
