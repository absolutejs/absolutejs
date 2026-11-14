import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bunCheckSupported } from '../../../src/cli/scripts/bunCheck';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* Island components usually live beside the registry (src/islands/), not in
 * the framework page directories. `absolute typecheck` only declared the
 * `.vue` files under vueDirectory and only generated Svelte declarations
 * under svelteDirectory, so a clean project whose registry imports
 * `./VueCounter.vue` failed bun check with TS2307, and a Svelte island's
 * props were never checked in server code. Every `.vue` and `.svelte` file
 * the project has is now covered, and a wrong island prop is still
 * reported. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
const PLAIN = bunCheckSupported() ? 'bun check' : 'tsc';
const VUE = bunCheckSupported() ? 'vue-check' : 'vue-tsc';
let projectRoot = '';

const linkNodeModules = async () => {
	const source = join(repoRoot, 'node_modules');
	const target = join(projectRoot, 'node_modules');
	await mkdir(join(target, '@absolutejs'), { recursive: true });
	const [entries, scoped] = await Promise.all([
		readdir(source),
		readdir(join(source, '@absolutejs'))
	]);
	await Promise.all([
		...entries
			.filter((name) => name !== '@absolutejs')
			.map((name) => symlink(join(source, name), join(target, name))),
		...scoped
			.filter((name) => name !== 'absolute' && !name.startsWith('.'))
			.map((name) =>
				symlink(
					join(source, '@absolutejs', name),
					join(target, '@absolutejs', name)
				)
			),
		symlink(repoRoot, join(target, '@absolutejs', 'absolute'))
	]);
};

const write = async (path: string, contents: string) => {
	await mkdir(dirname(join(projectRoot, path)), { recursive: true });
	await writeFile(join(projectRoot, path), contents);
};

const writeServer = (vueStart: string, svelteStart: string) =>
	write(
		'src/server.ts',
		`import type { IslandRegistryProps } from '@absolutejs/absolute';
import { islandRegistry } from './islands/registry';

type Registry = typeof islandRegistry;

export const vueProps: IslandRegistryProps<Registry, 'vue', 'VueCounter'> = { start: ${vueStart} };
export const svelteProps: IslandRegistryProps<Registry, 'svelte', 'SvelteCounter'> = { start: ${svelteStart} };
`
	);

const typecheck = async () => {
	const proc = Bun.spawn([process.execPath, CLI_PATH, 'typecheck'], {
		cwd: projectRoot,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	]);

	return { exitCode, output: `${stdout}\n${stderr}` };
};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const sections = (output: string) => {
	const plain = output.replace(ANSI, '');
	const found = new Map<string, string>();
	const headings = [...plain.matchAll(/^\[([^\]]+)\]$/gm)];
	headings.forEach((heading, index) => {
		const start = (heading.index ?? 0) + heading[0].length;
		const end = headings[index + 1]?.index ?? plain.length;
		found.set(heading[1] ?? '', plain.slice(start, end));
	});

	return found;
};

beforeAll(async () => {
	await ensureDistBuild();
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-typecheck-islands-'));
	await linkNodeModules();
	await write(
		'tsconfig.json',
		JSON.stringify({
			compilerOptions: {
				lib: ['DOM', 'DOM.Iterable', 'ESNext'],
				module: 'ESNext',
				moduleResolution: 'bundler',
				skipLibCheck: true,
				strict: true,
				target: 'ESNext',
				types: ['bun']
			},
			include: ['src']
		})
	);
	await write(
		'absolute.config.ts',
		"export default {\n\tislands: { registry: 'src/islands/registry.ts' },\n\tsvelteDirectory: 'src/frontend/svelte',\n\tvueDirectory: 'src/frontend/vue'\n};\n"
	);
	await write(
		'src/frontend/svelte/pages/Home.svelte',
		'<script lang="ts">\n\tlet { title }: { title: string } = $props();\n</script>\n\n<h1>{title}</h1>\n'
	);
	await write(
		'src/frontend/vue/pages/About.vue',
		'<template>\n\t<p>About</p>\n</template>\n'
	);
	await write(
		'src/islands/registry.ts',
		"import { defineIslandRegistry } from '@absolutejs/absolute/islands';\nimport SvelteCounter from './SvelteCounter.svelte';\nimport VueCounter from './VueCounter.vue';\n\nexport const islandRegistry = defineIslandRegistry({\n\tsvelte: { SvelteCounter },\n\tvue: { VueCounter }\n});\n"
	);
	await write(
		'src/islands/SvelteCounter.svelte',
		'<script lang="ts">\n\tlet { start }: { start: number } = $props();\n\tlet count = $state(start);\n</script>\n\n<button onclick={() => (count += 1)} type="button">{count}</button>\n'
	);
	await write(
		'src/islands/VueCounter.vue',
		'<script setup lang="ts">\nimport { ref } from \'vue\';\n\nconst props = defineProps<{ start: number }>();\nconst count = ref(props.start);\n</script>\n\n<template>\n\t<button type="button" @click="count++">{{ count }}</button>\n</template>\n'
	);
}, 300_000);

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: islands outside the framework directories', () => {
	test('a registry importing .vue and .svelte islands passes', async () => {
		await writeServer('1', '2');
		const { exitCode, output } = await typecheck();

		expect(output).not.toMatch(/TS\d{4}/);
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
	}, 300_000);

	test('a wrong prop on either island is still reported', async () => {
		await writeServer("'one'", "'two'");
		const { exitCode, output } = await typecheck();
		const reported = sections(output);
		const plain = reported.get(PLAIN) ?? '';
		const vue = reported.get(VUE) ?? '';

		expect(exitCode).not.toBe(0);
		expect(output).not.toContain('TS2307');
		// Svelte island props: the generated declaration, in the plain checker.
		expect(plain).toContain('src/server.ts');
		expect(plain).toContain(
			"Type 'string' is not assignable to type 'number'"
		);
		expect(plain.match(/TS2322/g)).toHaveLength(1);
		// Vue island props: only the Vue checker sees the component's type.
		expect(vue).toContain('src/server.ts');
		expect(vue).toContain(
			"Type 'string' is not assignable to type 'number'"
		);
	}, 300_000);
});
