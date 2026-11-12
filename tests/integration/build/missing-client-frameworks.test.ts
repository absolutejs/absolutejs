import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A project must build without the frameworks it doesn't use installed.
 * Client entries import `@absolutejs/absolute/client` (the Svelte hydration
 * index does; so does every islands bootstrap), whose island runtime lazily
 * imports a hydrator per framework. A missing framework's runtime resolves
 * to a throwing stub (src/build/missingClientFrameworks.ts) — never a bare
 * specifier, which a non-split dev bundle would hoist into a module-level
 * import the browser can't resolve.
 *
 * Fixtures live in the OS temp directory, not under the repo, because the
 * repo's own node_modules has every framework installed and would hide the
 * bug. Each holds only the frameworks it names plus a copy of this
 * package's dist, and builds in a child process whose cwd is the fixture. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtures: string[] = [];

type Mode = 'development' | 'production';

const createFixture = async (prefix: string, installed: string[]) => {
	const root = await mkdtemp(join(tmpdir(), prefix));
	fixtures.push(root);
	const packageRoot = join(root, 'node_modules', '@absolutejs', 'absolute');
	await mkdir(packageRoot, { recursive: true });
	await cp(join(repoRoot, 'package.json'), join(packageRoot, 'package.json'));
	await cp(join(repoRoot, 'dist'), join(packageRoot, 'dist'), {
		recursive: true
	});
	await Promise.all(
		installed.map((name) =>
			symlink(
				join(repoRoot, 'node_modules', name),
				join(root, 'node_modules', name)
			)
		)
	);

	return root;
};

const runBuild = async (root: string, mode: Mode, config: string) => {
	const scriptPath = join(root, `build-${mode}.ts`);
	await writeFile(
		scriptPath,
		`import { build } from ${JSON.stringify(join(repoRoot, 'src', 'core', 'build.ts'))};

const result = await build({
	...${config},
	buildDirectory: 'build-${mode}',
	mode: '${mode}',
	options: { throwOnError: true }
});
console.log(JSON.stringify(result?.manifest ?? {}));
`
	);
	const proc = Bun.spawn(['bun', scriptPath], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);
	const manifestLine = stdout.trim().split('\n').at(-1) ?? '{}';
	const manifest: Record<string, string> =
		exitCode === 0 ? JSON.parse(manifestLine) : {};

	return { exitCode, manifest, output: `${stdout}\n${stderr}` };
};

const clientSources = async (buildRoot: string) => {
	const files = await Array.fromAsync(
		new Bun.Glob('**/*.js').scan({ cwd: buildRoot })
	);

	return Promise.all(
		files.map(async (file) => ({
			file,
			source: await readFile(join(buildRoot, file), 'utf8')
		}))
	);
};

/** A bare import (static or dynamic) of any of `packages`. */
const bareImportOf = (packages: string) =>
	new RegExp(
		`(?:from|import)\\s*\\(?\\s*["'](?:${packages})(?:/[^"']*)?["']`
	);

beforeAll(async () => {
	await ensureDistBuild();
}, 600_000);

afterAll(async () => {
	await Promise.all(
		fixtures.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('Svelte-only project without Vue, Angular or React installed', () => {
	let root = '';
	const config = "{ svelteDirectory: 'svelte' }";

	beforeAll(async () => {
		root = await createFixture('absolute-svelte-only-', ['svelte']);
		await mkdir(join(root, 'svelte', 'pages'), { recursive: true });
		await writeFile(
			join(root, 'svelte', 'pages', 'Home.svelte'),
			`<script lang="ts">
	let { title }: { title: string } = $props();
	let count = $state(0);
</script>

<h1>{title}</h1>
<button onclick={() => count++}>{count}</button>
`
		);
	});

	test.each(['production', 'development'] as const)(
		'%s build succeeds and ships no bare import of a missing framework',
		async (mode) => {
			const { exitCode, manifest, output } = await runBuild(
				root,
				mode,
				config
			);

			expect(output).not.toContain('Could not resolve');
			expect(exitCode).toBe(0);
			expect(manifest.Home).toBeDefined();
			expect(manifest.HomeIndex).toBeDefined();
			const offenders = (await clientSources(join(root, `build-${mode}`)))
				.filter(({ source }) =>
					bareImportOf('vue|@vue|@angular|react|react-dom').test(source)
				)
				.map(({ file }) => file);
			expect(offenders).toEqual([]);
		},
		120_000
	);
});

describe('HTML page with a React island and no other framework installed', () => {
	let root = '';
	const config =
		"{ htmlDirectory: 'html', islands: { registry: 'islands/registry.ts' } }";

	beforeAll(async () => {
		root = await createFixture('absolute-html-react-island-', [
			'react',
			'react-dom'
		]);
		await mkdir(join(root, 'html', 'pages'), { recursive: true });
		await mkdir(join(root, 'islands'), { recursive: true });
		await writeFile(
			join(root, 'islands', 'PriceChart.tsx'),
			`export const PriceChart = ({ symbol }: { symbol: string }) => <output>{symbol}</output>;\n`
		);
		await writeFile(
			join(root, 'islands', 'registry.ts'),
			`import { defineIslandRegistry } from '@absolutejs/absolute/islands';
import { PriceChart } from './PriceChart';

export const islandRegistry = defineIslandRegistry({ react: { PriceChart } });
`
		);
		await writeFile(
			join(root, 'html', 'pages', 'prices.html'),
			`<!doctype html><html><head><title>prices</title></head><body>
<absolute-island framework="react" component="PriceChart" props='{"symbol":"BTC"}'></absolute-island>
</body></html>
`
		);
	});

	// Development is the case that matters most: the island pass doesn't
	// split there, so a bare external would be hoisted into the bootstrap.
	test.each(['development', 'production'] as const)(
		'%s build succeeds and the bootstrap never imports a missing framework',
		async (mode) => {
			const { exitCode, manifest, output } = await runBuild(
				root,
				mode,
				config
			);

			expect(output).not.toContain('Could not resolve');
			expect(exitCode).toBe(0);
			expect(manifest.AbsoluteIslandBootstrap).toBeDefined();
			expect(manifest.IslandReactPriceChart).toBeDefined();
			const offenders = (await clientSources(join(root, `build-${mode}`)))
				.filter(({ source }) =>
					bareImportOf('svelte|vue|@vue|@angular').test(source)
				)
				.map(({ file }) => file);
			expect(offenders).toEqual([]);
		},
		120_000
	);
});
