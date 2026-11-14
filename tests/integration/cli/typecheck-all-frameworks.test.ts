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
import { join, resolve } from 'node:path';
import { bunCheckSupported } from '../../../src/cli/scripts/bunCheck';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* A project configured with React, Svelte, Vue and Angular: every
 * framework's checker runs, each reports under its own label, and any one
 * failing fails the check. beta.172 replaced bun check with vue-check in any
 * project with Vue, which dropped the Svelte page-prop check in server files
 * (vue-check can't see the generated Svelte declarations) and reported plain
 * React errors as vue-check's.
 *
 * The fixture lives in the OS temp directory (the repo tsconfig includes
 * tests/**, and the failing variant is full of deliberate errors). It imports
 * `@absolutejs/absolute` the way an app does: its node_modules links the
 * package to this checkout, whose published declarations are in dist/. */

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

const write = (path: string, contents: string) =>
	writeFile(join(projectRoot, path), contents);

/* One wrong prop per framework when `broken`, none otherwise. */
const writeSources = async (broken: boolean) => {
	await write(
		'src/react/pages/Home.tsx',
		`import { Card } from './Card';\n\nexport const Home = () => <Card title=${broken ? '{42}' : '"Home"'} />;\n`
	);
	await write(
		'src/svelte/pages/Pricing.svelte',
		`<script lang="ts">\n\timport Badge from './Badge.svelte';\n\n\tlet { cssPath }: { cssPath: string } = $props();\n</script>\n\n<link rel="stylesheet" href={cssPath} />\n<Badge count={${broken ? "'three'" : '3'}} />\n`
	);
	await write(
		'src/angular/pages/home.component.ts',
		`import { Component } from '@angular/core';\nimport { BadgeComponent } from './badge.component';\n\n@Component({\n\timports: [BadgeComponent],\n\tselector: 'app-home',\n\tstandalone: true,\n\ttemplate: '<app-badge [label]="${broken ? 'count' : 'name'}" />'\n})\nexport class HomeComponent {\n\tcount = 3;\n\tname = 'home';\n}\n`
	);
	await write(
		'src/server.ts',
		`import { handleSveltePageRequest } from '@absolutejs/absolute/svelte';
import { handleVuePageRequest } from '@absolutejs/absolute/vue';
import type Pricing from './svelte/pages/Pricing.svelte';
import About from './vue/pages/About.vue';
import Profile from './vue/pages/Profile.vue';

export const pricing = () =>
	handleSveltePageRequest<typeof Pricing>({
		indexPath: '',
		pagePath: '',
		props: { cssPath: ${broken ? '1' : "'/pricing.css'"} }
	});

export const profile = () =>
	handleVuePageRequest({
		indexPath: '',
		Page: Profile,
		pagePath: '',
		props: { userId: ${broken ? "'ada'" : '1'} }
	});

export const about = () =>
	handleVuePageRequest({ indexPath: '', Page: About, pagePath: '' });
`
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

/* The output under each `[checker]` heading. */
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
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-typecheck-all-'));
	await Promise.all(
		['react', 'svelte', 'vue', 'angular'].map((framework) =>
			mkdir(join(projectRoot, 'src', framework, 'pages'), {
				recursive: true
			})
		)
	);
	await linkNodeModules();
	await write(
		'tsconfig.json',
		JSON.stringify({
			compilerOptions: {
				experimentalDecorators: true,
				jsx: 'react-jsx',
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
		"export default {\n\tangularDirectory: 'src/angular',\n\treactDirectory: 'src/react',\n\tsvelteDirectory: 'src/svelte',\n\tvueDirectory: 'src/vue'\n};\n"
	);
	// The project's own `*.vue` shim, as most Vue projects have: the one
	// typecheck adds for bun check must not collide with it (TS2300).
	await write(
		'src/env.d.ts',
		"declare module '*.vue' {\n\timport type { DefineComponent } from 'vue';\n\n\tconst component: DefineComponent;\n\texport default component;\n}\n"
	);
	await write(
		'src/react/pages/Card.tsx',
		'export const Card = ({ title }: { title: string }) => <h2>{title}</h2>;\n'
	);
	await write(
		'src/svelte/pages/Badge.svelte',
		'<script lang="ts">\n\tlet { count }: { count: number } = $props();\n</script>\n\n<span>{count}</span>\n'
	);
	await write(
		'src/vue/pages/Profile.vue',
		'<script setup lang="ts">\ndefineProps<{ userId: number }>();\n</script>\n\n<template>\n\t<p>{{ userId }}</p>\n</template>\n'
	);
	await write(
		'src/vue/pages/About.vue',
		'<template>\n\t<p>About</p>\n</template>\n'
	);
	await write(
		'src/angular/pages/badge.component.ts',
		"import { Component, Input } from '@angular/core';\n\n@Component({ selector: 'app-badge', standalone: true, template: '<span>{{ label }}</span>' })\nexport class BadgeComponent {\n\t@Input() label = '';\n}\n"
	);
}, 300_000);

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: React, Svelte, Vue and Angular together', () => {
	test('a wrong prop in each framework is reported under its own checker', async () => {
		await writeSources(true);
		const { exitCode, output } = await typecheck();
		const reported = sections(output);
		const plain = reported.get(PLAIN) ?? '';
		const vue = reported.get(VUE) ?? '';
		const svelte = reported.get('svelte-check') ?? '';
		const angular = reported.get('ngc') ?? '';

		expect(exitCode).not.toBe(0);
		expect([...reported.keys()].sort()).toEqual(
			[PLAIN, VUE, 'svelte-check', 'ngc'].sort()
		);

		// React: plain TypeScript, reported once, by the plain checker.
		expect(plain).toContain('src/react/pages/Home.tsx');
		expect(vue).not.toContain('Home.tsx');
		// Svelte page props in a server file (the generated declarations),
		// and a wrong prop inside a component (svelte-check).
		expect(plain).toContain('src/server.ts');
		expect(plain).toContain('cssPath');
		expect(svelte).toContain('src/svelte/pages/Pricing.svelte');
		expect(svelte).toContain(
			"Type 'string' is not assignable to type 'number'"
		);
		// Vue page props in a server file: only the Vue checker sees them.
		expect(vue).toContain('src/server.ts');
		expect(vue).toContain(
			"Type 'string' is not assignable to type 'number'"
		);
		expect(vue.match(/TS\d+/g)).toHaveLength(1);
		// Angular template bindings.
		expect(angular).toContain('home.component.ts');
		expect(angular).toContain('TS2322');

		expect(output).toContain(
			`Typecheck failed: ${PLAIN}, ${VUE}, svelte-check, ngc`
		);
	}, 300_000);

	test('the same project with correct props passes', async () => {
		await writeSources(false);
		const { exitCode, output } = await typecheck();

		expect(output).not.toMatch(/TS\d{4}/);
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
	}, 300_000);
});
