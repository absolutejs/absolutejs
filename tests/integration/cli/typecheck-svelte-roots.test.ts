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

/* A project with Svelte pages in svelteDirectory and Svelte islands beside
 * the registry (src/islands) has two Svelte roots. beta.180 ran svelte-check
 * once per root, and each run wrote the same .absolutejs/tsconfig.svelte-check
 * .json concurrently: the last write won, both runs checked the same root,
 * an error inside an island component passed, and an error in a page was
 * reported twice under two `[svelte-check]` headings. svelte-check now runs
 * once over every root.
 *
 * An error in an Angular component's plain TypeScript was also reported by
 * both the plain checker and ngc, which read the same file. It is reported
 * once, under the plain checker; ngc keeps the template errors only it
 * sees. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
const PLAIN = bunCheckSupported() ? 'bun check' : 'tsc';
const RACE_RUNS = 4;
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

type Breakage = {
	angularTemplate?: boolean;
	angularTs?: boolean;
	island?: boolean;
	page?: boolean;
};

const writeSources = async (broken: Breakage = {}) => {
	await write(
		'src/frontend/svelte/pages/Home.svelte',
		`<script lang="ts">\n\tlet { title }: { title: string } = $props();\n\tconst size: number = ${broken.page ? "'large'" : '1'};\n</script>\n\n<h1 data-size={size}>{title}</h1>\n`
	);
	await write(
		'src/islands/SvelteCounter.svelte',
		`<script lang="ts">\n\tlet { start }: { start: number } = $props();\n\tlet count = $state(start);\n\tconst step: number = ${broken.island ? "'one'" : '1'};\n</script>\n\n<button onclick={() => (count += step)} type="button">{count}</button>\n`
	);
	await write(
		'src/frontend/angular/pages/home.component.ts',
		`import { Component } from '@angular/core';\n\n@Component({\n\tselector: 'app-home',\n\tstandalone: true,\n\ttemplate: '<p>{{ ${broken.angularTemplate ? 'missing' : 'name'} }}</p>'\n})\nexport class HomeComponent {\n\tname: string = ${broken.angularTs ? '42' : "'home'"};\n}\n`
	);
};

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

/* Every `[checker]` heading, in order, with the output under it. */
const sections = (output: string) => {
	const plain = output.replace(ANSI, '');
	const headings = [...plain.matchAll(/^\[([^\]]+)\]$/gm)];

	return headings.map((heading, index) => {
		const start = (heading.index ?? 0) + heading[0].length;
		const end = headings[index + 1]?.index ?? plain.length;

		return { body: plain.slice(start, end), name: heading[1] ?? '' };
	});
};

const failedLabels = (output: string) =>
	(
		/Typecheck failed: (.+)$/m.exec(output.replace(ANSI, ''))?.[1] ?? ''
	).split(', ');

const occurrences = (text: string, needle: string) =>
	text.split(needle).length - 1;

beforeAll(async () => {
	await ensureDistBuild();
	projectRoot = await mkdtemp(
		join(tmpdir(), 'absolute-typecheck-svelte-roots-')
	);
	await linkNodeModules();
	await write(
		'tsconfig.json',
		JSON.stringify({
			compilerOptions: {
				experimentalDecorators: true,
				lib: ['DOM', 'DOM.Iterable', 'ESNext'],
				module: 'ESNext',
				moduleResolution: 'bundler',
				skipLibCheck: true,
				strict: true,
				target: 'ESNext',
				types: ['bun'],
				useDefineForClassFields: false
			},
			include: ['src']
		})
	);
	await write(
		'absolute.config.ts',
		"export default {\n\tangularDirectory: 'src/frontend/angular',\n\tislands: { registry: 'src/islands/registry.ts' },\n\tsvelteDirectory: 'src/frontend/svelte',\n\tvueDirectory: 'src/frontend/vue'\n};\n"
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
		'src/islands/VueCounter.vue',
		'<script setup lang="ts">\nimport { ref } from \'vue\';\n\nconst props = defineProps<{ start: number }>();\nconst count = ref(props.start);\n</script>\n\n<template>\n\t<button type="button" @click="count++">{{ count }}</button>\n</template>\n'
	);
}, 300_000);

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: Svelte pages and Svelte islands together', () => {
	test('the clean project passes', async () => {
		await writeSources();
		const { exitCode, output } = await typecheck();

		expect(output).not.toMatch(/TS\d{4}/);
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
	}, 300_000);

	test('an error inside an island component fails, reported once by svelte-check', async () => {
		await writeSources({ island: true });
		for (let run = 0; run < RACE_RUNS; run += 1) {
			const { exitCode, output } = await typecheck();
			const reported = sections(output);
			const svelte = reported.filter(
				(section) => section.name === 'svelte-check'
			);

			expect(exitCode).not.toBe(0);
			expect(svelte).toHaveLength(1);
			expect(
				occurrences(
					svelte[0]?.body ?? '',
					'src/islands/SvelteCounter.svelte'
				)
			).toBe(1);
			expect(svelte[0]?.body).toContain(
				"Type 'string' is not assignable to type 'number'"
			);
			expect(
				reported.filter((section) =>
					section.body.includes('SvelteCounter.svelte')
				)
			).toHaveLength(1);
			expect(failedLabels(output)).toEqual(['svelte-check']);
		}
	}, 600_000);

	test('an error in a Svelte page is reported once', async () => {
		await writeSources({ page: true });
		const { exitCode, output } = await typecheck();
		const reported = sections(output);
		const svelte = reported.filter(
			(section) => section.name === 'svelte-check'
		);

		expect(exitCode).not.toBe(0);
		expect(svelte).toHaveLength(1);
		expect(
			occurrences(
				svelte[0]?.body ?? '',
				'src/frontend/svelte/pages/Home.svelte'
			)
		).toBe(1);
		expect(
			failedLabels(output).filter((label) => label === 'svelte-check')
		).toHaveLength(1);
		expect(failedLabels(output)).toEqual(['svelte-check']);
	}, 300_000);

	test('an Angular TypeScript error is reported under one checker, the plain one', async () => {
		await writeSources({ angularTs: true });
		const { exitCode, output } = await typecheck();
		const reported = sections(output).filter((section) =>
			section.body.includes('home.component.ts')
		);

		expect(exitCode).not.toBe(0);
		expect(reported.map((section) => section.name)).toEqual([PLAIN]);
		expect(reported[0]?.body).toContain('TS2322');
		expect(failedLabels(output)).toEqual([PLAIN]);
	}, 300_000);

	test('an Angular template error is reported under ngc only', async () => {
		await writeSources({ angularTemplate: true });
		const { exitCode, output } = await typecheck();
		const reported = sections(output).filter((section) =>
			section.body.includes('home.component.ts')
		);

		expect(exitCode).not.toBe(0);
		expect(reported.map((section) => section.name)).toEqual(['ngc']);
		expect(failedLabels(output)).toEqual(['ngc']);
	}, 300_000);
});
