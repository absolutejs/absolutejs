import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from '../../../src/core/build';

/* Back-to-back production builds into the same directory must leave one set
 * of hashed outputs. The stale-output cleanup used to recognise only hex
 * hashes, but Bun's `[hash]` is base36, so nearly every earlier server, page,
 * worker and React Server Components bundle stayed behind. */

const tempDirs: string[] = [];
const testBuildRoot = join(
	resolve(import.meta.dir, '..', '..', '..'),
	'.test-builds'
);

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

const HASHED = /^(.+)\.[a-z0-9]{8,}(\.[a-z0-9]+(?:\.map)?)$/;

const hashedOutputs = async (buildRoot: string) => {
	const files = await readdir(buildRoot, { recursive: true });

	return files
		.map((file) => file.split('\\').join('/'))
		.filter((file) => !file.includes('vendor/'))
		.filter((file) => {
			const name = file.slice(file.lastIndexOf('/') + 1);

			return HASHED.test(name) || /^chunk-[a-z0-9]{8,}\.js$/.test(name);
		});
};

const identityOf = (file: string) => {
	const slash = file.lastIndexOf('/');
	const match = file.slice(slash + 1).match(HASHED);

	return match ? `${file.slice(0, slash + 1)}${match[1]}${match[2]}` : file;
};

const writeSources = async (root: string, label: string, extra: boolean) => {
	const react = join(root, 'react');
	const svelte = join(root, 'svelte');
	await mkdir(join(react, 'pages'), { recursive: true });
	await mkdir(join(react, 'client'), { recursive: true });
	await mkdir(join(svelte, 'pages'), { recursive: true });
	await writeFile(
		join(react, 'client', 'worker.ts'),
		`self.postMessage(${JSON.stringify(label)});`
	);
	await writeFile(
		join(react, 'pages', 'Dashboard.tsx'),
		`export function Dashboard() {
	new Worker(new URL('../client/worker.ts', import.meta.url));
	return <main>${label}</main>;
}`
	);
	const extraPage = join(react, 'pages', 'Extra.tsx');
	if (extra)
		await writeFile(
			extraPage,
			`export function Extra() { return <p>extra</p>; }`
		);
	else await rm(extraPage, { force: true });
	await writeFile(
		join(svelte, 'pages', 'Panel.svelte'),
		`<script lang="ts">let count = $state(0);</script>
<button onclick={() => count++}>${label} {count}</button>`
	);
};

// The framework compilers write their intermediates under
// `<process.cwd()>/.absolutejs/generated`, so build from the fixture root.
const runBuild = async (root: string, buildRoot: string) => {
	const previousCwd = process.cwd();
	process.chdir(root);
	try {
		await build({
			buildDirectory: buildRoot,
			cwd: root,
			mode: 'production',
			options: { throwOnError: true },
			reactDirectory: join(root, 'react'),
			svelteDirectory: join(root, 'svelte')
		});
	} finally {
		process.chdir(previousCwd);
	}
};

describe('production stale-output cleanup', () => {
	test('two back-to-back builds leave one set of hashed outputs', async () => {
		await mkdir(testBuildRoot, { recursive: true });
		const root = await mkdtemp(join(testBuildRoot, 'absolute-stale-'));
		tempDirs.push(root);
		const buildRoot = join(root, 'build');

		await writeSources(root, 'first build', true);
		await runBuild(root, buildRoot);
		const first = await hashedOutputs(buildRoot);
		expect(first.some((file) => file.includes('Extra'))).toBe(true);

		// Files the user put in the build directory are not build outputs.
		const userFiles = [
			join(buildRoot, 'robots.txt'),
			join(buildRoot, 'fonts', 'inter.variable.woff2'),
			join(buildRoot, 'downloads', 'report.a1b2c3d4.pdf')
		];
		await mkdir(join(buildRoot, 'fonts'), { recursive: true });
		await mkdir(join(buildRoot, 'downloads'), { recursive: true });
		await Promise.all(userFiles.map((file) => writeFile(file, 'user')));

		// Change every source so every hash changes, and delete a page.
		await writeSources(root, 'second build', false);
		await runBuild(root, buildRoot);
		const second = await hashedOutputs(buildRoot);

		const counts = new Map<string, number>();
		for (const file of second) {
			if (/^chunk-|\/chunk-/.test(file)) continue;
			const identity = identityOf(file);
			counts.set(identity, (counts.get(identity) ?? 0) + 1);
		}
		const duplicated = [...counts].filter(([, count]) => count > 1);
		expect(duplicated).toEqual([]);
		// Nothing from the first build survives: every hash changed.
		const leftovers = first.filter(
			(file) => second.includes(file) && !file.includes('chunk-')
		);
		expect(leftovers).toEqual([]);
		expect(second.some((file) => file.includes('Extra'))).toBe(false);
		expect(second.some((file) => file.includes('Dashboard'))).toBe(true);
		expect(second.some((file) => file.includes('Panel'))).toBe(true);
		for (const file of userFiles) expect(existsSync(file)).toBe(true);
	}, 120_000);
});
