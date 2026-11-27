import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/* `absolute i18n extract`, `check --unused`, and finding the catalogs
 * from the config, through this checkout's CLI. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_ENTRY = join(repoRoot, 'src', 'cli', 'index.ts');
const fromSource = (path: string) =>
	join(repoRoot, 'src', path).replace(/\\/g, '/');

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-i18n-extract-'));
	roots.push(root);
	await Promise.all(
		Object.entries(files).map(async ([path, contents]) => {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), contents);
		})
	);

	return root;
};

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => rm(root, { force: true, recursive: true }))
	);
});

const run = async (cwd: string, args: string[]) => {
	const proc = Bun.spawn(['bun', CLI_ENTRY, 'i18n', ...args], {
		cwd,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);

	return { exitCode, output: `${stdout}${stderr}` };
};

const ENGLISH = `{
  "nav": {
    "about": "About",
    "home": "Home"
  },
  "title": "Acme"
}
`;
const FRENCH = `{
  "nav": {
    "home": "Accueil"
  }
}
`;

describe('absolute i18n extract', () => {
	test('lists what each locale is missing, and exits 0', async () => {
		const root = await makeProject({
			'en.json': ENGLISH,
			'fr.json': FRENCH
		});
		const { exitCode, output } = await run(root, [
			'extract',
			'en.json',
			'fr.json'
		]);

		expect(exitCode).toBe(0);
		expect(output).toContain('fr.json  2 missing');
		expect(output).toContain('+ nav.about');
		expect(output).toContain('+ title');
		// Listed, not written.
		expect(await readFile(join(root, 'fr.json'), 'utf8')).toBe(FRENCH);
	});

	test('--write adds them, in the default’s order and the file’s indentation', async () => {
		const root = await makeProject({
			'en.json': ENGLISH,
			'fr.json': FRENCH
		});
		const { output } = await run(root, [
			'extract',
			'en.json',
			'fr.json',
			'--write'
		]);

		expect(output).toContain('fr.json  2 added');
		expect(await readFile(join(root, 'fr.json'), 'utf8')).toBe(
			`{
  "nav": {
    "about": "About",
    "home": "Accueil"
  },
  "title": "Acme"
}
`
		);
	});

	test('does not rewrite a module, and says so', async () => {
		const module =
			"// kept\nexport default { nav: { home: 'Accueil' } };\n";
		const root = await makeProject({ 'en.json': ENGLISH, 'fr.ts': module });
		const { output } = await run(root, [
			'extract',
			'en.json',
			'fr.ts',
			'--write'
		]);

		expect(output).toContain('a module is not rewritten');
		expect(await readFile(join(root, 'fr.ts'), 'utf8')).toBe(module);
	});

	test('says a complete catalog is complete', async () => {
		const root = await makeProject({
			'en.json': ENGLISH,
			'fr.json': ENGLISH
		});

		expect(
			(await run(root, ['extract', 'en.json', 'fr.json'])).output
		).toContain('✓ fr.json');
	});
});

describe('absolute i18n check --unused', () => {
	test('reports the keys nothing reads, without failing', async () => {
		const root = await makeProject({
			'en.json': ENGLISH,
			'src/Nav.tsx':
				"export const Nav = () => <a>{t('nav.home')}</a>;\nconst x = t(key);\n",
			'src/page.html': '<h1 data-i18n="title"></h1>'
		});
		const { exitCode, output } = await run(root, [
			'check',
			'en.json',
			'--unused'
		]);

		expect(exitCode).toBe(0);
		expect(output).toContain('1 key nothing reads by name:');
		expect(output).toContain('○ nav.about');
		expect(output).not.toContain('○ nav.home');
		expect(output).not.toContain('○ title');
		expect(output).toContain('1 call passes a key that is not a literal');
	});
});

describe('with i18n.catalogs in the config', () => {
	test('no paths are needed', async () => {
		const root = await makeProject({
			'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	i18n: {
		catalogs: { en: './messages/en.json', fr: './messages/fr.json' },
		defaultLocale: 'en',
		locales: ['en', 'fr']
	}
});
`,
			'messages/en.json': ENGLISH,
			'messages/fr.json': FRENCH
		});
		const extracted = await run(root, ['extract']);
		const checked = await run(root, ['check']);

		expect(extracted.output).toContain('./messages/fr.json  2 missing');
		// Missing keys fail the check, as they do with paths given.
		expect(checked.exitCode).toBe(1);
		expect(checked.output).toContain('missing nav.about');
	});

	test('and without it, the command says what it needs', async () => {
		const root = await makeProject({ 'en.json': ENGLISH });
		const { exitCode, output } = await run(root, ['extract']);

		expect(exitCode).toBe(1);
		expect(output).toContain('set i18n.catalogs in the config');
	});
});
