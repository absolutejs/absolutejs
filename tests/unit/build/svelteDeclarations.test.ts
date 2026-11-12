import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	generateSvelteDeclarations,
	svelteDeclarationRootDirs,
	tsconfigHasSvelteDeclarationRoot
} from '../../../src/build/svelteDeclarations';

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { force: true, recursive: true });
	}
});

const project = async (withSvelte2Tsx: boolean) => {
	const root = realpathSync(await mkdtemp(join(tmpdir(), 'absolute-svelte-dts-')));
	roots.push(root);
	await mkdir(join(root, 'svelte', 'pages'), { recursive: true });
	if (withSvelte2Tsx) {
		await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
	}
	await writeFile(
		join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				module: 'ESNext',
				moduleResolution: 'bundler',
				skipLibCheck: true,
				strict: true,
				target: 'ESNext'
			}
		})
	);
	await writeFile(
		join(root, 'svelte', 'pages', 'Home.svelte'),
		`<script lang="ts">\n\tlet { title }: { title: string } = $props();\n</script>\n<h1>{title}</h1>\n`
	);

	return root;
};

const declarationOf = (root: string) =>
	readFileSync(
		join(root, '.absolutejs', 'types', 'svelte', 'svelte', 'pages', 'Home.svelte.d.ts'),
		'utf-8'
	);

describe('generateSvelteDeclarations', () => {
	test('declares each component with its real props, and skips an unchanged tree', async () => {
		const root = await project(true);
		const options = { projectRoot: root, svelteDirectory: 'svelte' };

		expect((await generateSvelteDeclarations(options)).status).toBe('generated');
		expect(declarationOf(root)).toContain('title: string');
		expect((await generateSvelteDeclarations(options)).status).toBe('unchanged');

		await writeFile(
			join(root, 'svelte', 'pages', 'Home.svelte'),
			`<script lang="ts">\n\tlet { count }: { count: number } = $props();\n</script>\n<p>{count}</p>\n`
		);
		expect((await generateSvelteDeclarations(options)).status).toBe('generated');
		expect(declarationOf(root)).toContain('count: number');
	}, 60_000);

	test('never writes a declaration outside the mirror', async () => {
		const root = await project(true);
		await mkdir(join(root, 'types'), { recursive: true });
		await writeFile(
			join(root, 'types', 'metadata.ts'),
			'export type Metadata = { title: string };\n'
		);
		await writeFile(
			join(root, 'svelte', 'pages', 'Home.svelte'),
			`<script lang="ts">\n\timport type { Metadata } from '../../types/metadata';\n\tlet { meta }: { meta: Metadata } = $props();\n</script>\n<h1>{meta.title}</h1>\n`
		);
		const result = await generateSvelteDeclarations({
			projectRoot: root,
			svelteDirectory: 'svelte'
		});

		expect(result.status).toBe('generated');
		expect(declarationOf(root)).toContain('meta: Metadata');
		expect(existsSync(join(root, 'types', 'metadata.d.ts'))).toBe(false);
		expect(
			existsSync(join(root, '.absolutejs', 'types', 'svelte', 'types'))
		).toBe(false);
	}, 60_000);

	test('reports unavailable, without throwing, when svelte2tsx is missing', async () => {
		const root = await project(false);
		const result = await generateSvelteDeclarations({
			projectRoot: root,
			svelteDirectory: 'svelte'
		});

		expect(result).toEqual({
			reason: 'svelte2tsx is not installed',
			status: 'unavailable'
		});
	});
});

describe('rootDirs helpers', () => {
	test('anchor the project and the mirror on the config directory', () => {
		expect(svelteDeclarationRootDirs('/app', '/app/.absolutejs')).toEqual([
			'..',
			'types/svelte'
		]);
		expect(svelteDeclarationRootDirs('/app', '/app')).toEqual([
			'.',
			'.absolutejs/types/svelte'
		]);
	});

	test('recognise the mirror in a project tsconfig', () => {
		expect(tsconfigHasSvelteDeclarationRoot(['.', './.absolutejs/types/svelte/'])).toBe(true);
		expect(tsconfigHasSvelteDeclarationRoot(['.'])).toBe(false);
		expect(tsconfigHasSvelteDeclarationRoot(undefined)).toBe(false);
	});
});
