import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { applyAbsoluteConfigEdit } from '../../../src/cli/config/absolute/editAbsoluteConfig';
import { findConfigObject } from '../../../src/cli/config/absolute/resolveAbsoluteConfig';
import { findAuthSettingsObject } from '../../../src/cli/config/auth/resolveAuthSettings';
import { pageTemplates } from '../../../src/cli/generate/pageTemplates';

/* `absolute add angular` failed on a freshly scaffolded config with
 * "Could not find defineConfig". The AST walk pushed children with
 * `forEachChild((child) => pending.push(child))`; `forEachChild` stops at
 * the first truthy callback result, so only a file's first statement (the
 * `import { defineConfig }` line) was ever visited. */

// What create-absolutejs 0.20.9 writes.
const SCAFFOLD_CONFIG = `import { defineConfig } from '@absolutejs/absolute'

export default defineConfig({
	assetsDirectory: 'src/backend/assets',
	buildDirectory: 'build',
	reactDirectory: 'src/frontend/react',
	publicDirectory: 'public'
})
`;

const parse = (text: string) =>
	ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true);

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

describe('config editing on a scaffolded config', () => {
	test('finds defineConfig after an import', () => {
		const object = findConfigObject(parse(SCAFFOLD_CONFIG));

		expect(object?.properties.length).toBe(4);
	});

	test('adds angularDirectory to export default defineConfig({...})', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'absolute-add-angular-'));
		directories.push(dir);
		const configPath = join(dir, 'absolute.config.ts');
		await writeFile(configPath, SCAFFOLD_CONFIG);

		const edit = applyAbsoluteConfigEdit(configPath, {
			name: 'angularDirectory',
			value: './src/frontend/angular'
		});

		expect(edit).toEqual({ message: 'Updated angularDirectory', ok: true });
		const updated = await readFile(configPath, 'utf8');
		expect(updated).toContain(
			"publicDirectory: 'public',\n\tangularDirectory: './src/frontend/angular'"
		);
		expect(
			updated.startsWith(
				"import { defineConfig } from '@absolutejs/absolute'"
			)
		).toBe(true);
	});

	test('finds defineAuthSettings after an import', () => {
		const object = findAuthSettingsObject(
			parse(`import { defineAuthSettings } from '@absolutejs/auth'

export default defineAuthSettings({ providers: [] })
`)
		);

		expect(object?.properties.length).toBe(1);
	});
});

describe('absolute generate page --framework angular', () => {
	const page = pageTemplates.angular({
		cssHref: '../../../styles/indexes/about.css',
		kebab: 'about',
		navImportPath: '../../shared/navData',
		navItems: [
			{ href: '/', label: 'Home' },
			{ href: '/about', label: "About 'us'" }
		],
		pascal: 'About',
		title: 'About'
	});

	test('imports nothing outside the Angular package', () => {
		const imports = [...page.matchAll(/from '([^']+)'/g)].map(
			([, specifier]) => specifier
		);

		expect(imports).toEqual(['@angular/core']);
		expect(page).not.toContain('navData');
	});

	test('bakes the nav items into the page and still compiles', () => {
		expect(page).toContain('{ href: "/", label: "Home" }');
		expect(page).toContain(`{ href: "/about", label: "About 'us'" }`);
		const { diagnostics } = ts.transpileModule(page, {
			compilerOptions: {
				experimentalDecorators: true,
				target: ts.ScriptTarget.ES2022
			},
			reportDiagnostics: true
		});
		expect(diagnostics ?? []).toEqual([]);
	});
});
