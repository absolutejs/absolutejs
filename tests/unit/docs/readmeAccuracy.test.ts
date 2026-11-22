import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* The README's checkable claims, pinned to the code they describe.
 *
 * Every one of these was wrong at the same time, and the Quick Start — the
 * first code anyone copies — could not run: it imported from `absolutejs`
 * rather than `@absolutejs/absolute`, took `build` and the page handlers
 * from paths that do not exist, and used a `networkingPlugin` export that
 * has never existed (the plugin is `networking`). The headline said Vue and
 * Angular were "coming" on the same page that documents Vue router pages,
 * the requirements table asked for Bun >= 1.2 while `engines` required
 * >= 1.4.4, and the roadmap listed Angular handlers and a hot-reload dev
 * server as future work.
 *
 * A doc that is wrong about the install step costs more trust than a doc
 * that is thin, so the parts a test can check are checked. Prose is not:
 * nothing here asserts tone or completeness. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf-8');
const manifest: {
	engines?: { bun?: string };
	exports?: Record<string, unknown>;
	name: string;
} = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));

describe('README imports', () => {
	/* The package is `@absolutejs/absolute`; `absolutejs` is not a specifier
	 * that resolves to anything. */
	test('never import from a package name that does not exist', () => {
		expect(readme).not.toMatch(/from '(?!@absolutejs\/)absolutejs/);
		expect(readme).not.toContain("from 'absolutejs/");
	});

	test('every framework subpath it imports from is a real export', () => {
		const subpaths = [
			...readme.matchAll(/from '@absolutejs\/absolute([^']*)'/g)
		]
			.map((match) => `.${match[1] || ''}`)
			.filter((path) => path !== '.');

		expect(subpaths.length).toBeGreaterThan(0);
		for (const subpath of new Set(subpaths))
			expect(Object.keys(manifest.exports ?? {})).toContain(subpath);
	});

	/* The strongest of these: every NAME the README imports has to exist on
	 * the module it imports it from. `networkingPlugin` was cited in two
	 * places and has never been an export, so a reader following the Quick
	 * Start got `undefined` passed to `.use()`. Path-only checks would not
	 * have caught it. */
	test('every name it imports exists on the module it imports from', async () => {
		/* SOURCE, not `dist`. The unit job in CI runs before the build, so a
		 * test that reaches into `dist` passes on a developer's machine and
		 * fails there with "Cannot find module" — which is exactly what the
		 * first version of this test did. */
		const SUBPATH_MODULE: Record<string, string> = {
			'.': '../../../src/index',
			'./react': '../../../src/react/index',
			'./svelte': '../../../src/svelte/index',
			'./vue': '../../../src/vue/index'
		};
		/* Value imports only. A type exists for the compiler and not at run
		 * time, so `FileRouteContext` is absent from the module object while
		 * being perfectly exported — the subpath check above covers those. */
		const imports = [
			...readme.matchAll(
				/import \{([^}]+)\} from '@absolutejs\/absolute([^']*)'/g
			)
		];

		expect(imports.length).toBeGreaterThan(0);
		for (const [, names, suffix] of imports) {
			const subpath = `.${suffix || ''}`;
			const modulePath = SUBPATH_MODULE[subpath];
			if (modulePath === undefined) continue;
			const loaded: Record<string, unknown> = await import(modulePath);
			for (const name of (names ?? '')
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part !== '' && !part.startsWith('type ')))
				expect({
					export: name,
					from: subpath,
					has: name in loaded
				}).toEqual({
					export: name,
					from: subpath,
					has: true
				});
		}
	});

	/* `networkingPlugin` was cited for years and never existed. */
	test('does not name the plugin that never existed', () => {
		expect(readme).not.toContain('networkingPlugin');
		expect(readme).toContain('networking');
	});

	test('names the auth package as it is published', () => {
		expect(readme).not.toContain('`absolute-auth`');
		expect(readme).toContain('@absolutejs/auth');
	});
});

describe('README claims about the runtime', () => {
	test('the required Bun version matches engines', () => {
		const required = manifest.engines?.bun?.replace(/^>=\s*/, '');

		expect(required).toBeDefined();
		expect(readme).toContain(required ?? 'MISSING');
	});
});

describe('README claims about frameworks', () => {
	/* Six frameworks ship. Saying two of them are "coming" on a page that
	 * documents one of them is the worst kind of stale. */
	test('does not call a shipped framework "coming"', () => {
		expect(readme).not.toMatch(/Vue.{0,12}Angular coming/s);
		expect(readme).not.toMatch(/\*\*Angular\*\* handlers\n/);
	});

	test('the headline names every framework that ships', () => {
		const headline = readme.split('\n').slice(0, 6).join(' ');
		for (const framework of [
			'React',
			'Svelte',
			'Vue',
			'Angular',
			'HTML',
			'HTMX'
		])
			expect(headline).toContain(framework);
	});
});

describe('README documents the CLI', () => {
	/* The binary is the primary interface and the README mentioned it only
	 * in passing, in four places, never introducing it. */
	test('has a CLI section naming the commands a project starts with', () => {
		expect(readme).toContain('## The CLI');
		for (const command of [
			'absolute dev',
			'absolute build',
			'absolute start',
			'absolute typecheck',
			'absolute --help',
			'absolute --version'
		])
			expect(readme).toContain(command);
	});
});
