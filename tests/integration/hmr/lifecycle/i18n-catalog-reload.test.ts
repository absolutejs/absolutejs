import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';

/* Editing a message catalog while `absolute dev` runs.
 *
 * A catalog reaches the server four ways, and each is a different
 * question for a running process: the default locale's, imported and
 * handed to `defineI18n` as a value; a locale's behind a loader that
 * imports a module; one behind a loader that reads a JSON file; and one
 * imported as JSON. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const ROOT = join(PROJECT_ROOT, '.hmr-temp', 'i18n-catalogs');
const fromSource = (path: string) =>
	join(PROJECT_ROOT, 'src', path).replace(/\\/g, '/');

const FILES: Record<string, string> = {
	'absolute.config.ts': `import { defineConfig } from '${fromSource('index.ts')}';

export default defineConfig({
	buildDirectory: './build',
	htmlDirectory: './html',
	i18n: {
		catalogs: {
			de: './src/messages/de.json',
			en: './src/messages/en.ts',
			es: './src/messages/es.json',
			fr: './src/messages/fr.ts'
		},
		defaultLocale: 'en',
		locales: ['en', 'fr', 'de', 'es']
	}
});
`,
	'html/pages/Placeholder.html':
		'<!doctype html><html><head><title>p</title></head><body>p</body></html>\n',
	'server.ts': `import { Elysia } from 'elysia';
import { defineI18n, i18nPlugin, networking, prepare } from '${fromSource('index.ts')}';
import en from './src/messages/en';
import es from './src/messages/es.json';

const { absolutejs } = await prepare();
const i18n = defineI18n({
	defaultLocale: 'en',
	loaders: {
		de: () => Bun.file(import.meta.dir + '/src/messages/de.json').json(),
		es,
		fr: () => import('./src/messages/fr')
	},
	locales: ['en', 'fr', 'de', 'es'],
	messages: en
});

export const server = new Elysia()
	.use(absolutejs)
	.use(i18nPlugin(i18n))
	.get('/:locale?/hello', ({ i18n: request }) => request.t('hello'))
	.use(networking);
`,
	'src/messages/de.json': '{ "hello": "Hallo" }\n',
	'src/messages/en.ts': "export default { hello: 'Hello' };\n",
	'src/messages/es.json': '{ "hello": "Hola" }\n',
	'src/messages/fr.ts': "export default { hello: 'Bonjour' };\n"
};

let server: DevServer;

/* The fixture's node_modules: this repository's packages, and the
 * framework itself as this checkout's source.
 *
 * A dev server run outside the framework's own directory looks for its
 * browser client in the project's installed copy of the package, at
 * `dist/dev/client`. Pointing that at `src/dev/client` is what makes the
 * server under test this checkout's, whatever copy of the package a
 * machine happens to have installed. */
const linkNodeModules = () => {
	const source = join(PROJECT_ROOT, 'node_modules');
	const target = join(ROOT, 'node_modules');
	mkdirSync(join(target, '@absolutejs', 'absolute', 'dist', 'dev'), {
		recursive: true
	});
	for (const name of readdirSync(source)) {
		if (name === '.bin' || name === '@absolutejs') continue;
		symlinkSync(join(source, name), join(target, name));
	}
	symlinkSync(
		join(PROJECT_ROOT, 'src', 'dev', 'client'),
		join(target, '@absolutejs', 'absolute', 'dist', 'dev', 'client')
	);
};

beforeAll(async () => {
	rmSync(ROOT, { force: true, recursive: true });
	for (const [path, contents] of Object.entries(FILES)) {
		mkdirSync(join(ROOT, path, '..'), { recursive: true });
		writeFileSync(join(ROOT, path), contents);
	}
	linkNodeModules();
	server = await startDevServer({
		configPath: join(ROOT, 'absolute.config.ts'),
		cwd: ROOT,
		serverEntry: join(ROOT, 'server.ts')
	});
}, 180_000);

afterAll(async () => {
	await server?.kill();
	rmSync(ROOT, { force: true, recursive: true });
});

const hello = async (path: string) =>
	(await fetch(`${server.baseUrl}${path}`)).text();

const becomes = async (path: string, expected: string, attempt = 0) => {
	const said = await hello(path).catch(() => '');
	if (said === expected || attempt >= 40) return said;
	await Bun.sleep(250);

	return becomes(path, expected, attempt + 1);
};

const edit = (file: string, contents: string) => {
	const from = server.outputLines.length;
	writeFileSync(join(ROOT, 'src/messages', file), contents);

	return () => server.outputLines.slice(from).join('\n');
};

describe('a catalog edited while dev runs', () => {
	test('every locale starts with its own message', async () => {
		expect(await hello('/hello')).toBe('Hello');
		expect(await hello('/fr/hello')).toBe('Bonjour');
		expect(await hello('/de/hello')).toBe('Hallo');
		expect(await hello('/es/hello')).toBe('Hola');
	});

	/* The dev server swapped the module in place and said so, and the
	 * page kept the old message: the catalog had been loaded once and
	 * kept, and nothing restarted the server to clear it. */
	test('a locale loaded from a module by its loader is the new one', async () => {
		const output = edit('fr.ts', "export default { hello: 'Salut' };\n");

		expect(await becomes('/fr/hello', 'Salut')).toBe('Salut');
		expect(output()).not.toContain('[abs:restart]');
	}, 60_000);

	/* Read when a request needs it, so the next request reads the new
	 * file. The config names it as a catalog, which is how the server
	 * knows not to restart for a `.json` it would otherwise assume was
	 * read once at startup. */
	test('a locale its loader reads from a JSON file is the new one, without a restart', async () => {
		const output = edit('de.json', '{ "hello": "Servus" }\n');

		expect(await becomes('/de/hello', 'Servus')).toBe('Servus');
		await Bun.sleep(1500);
		expect(output()).not.toContain('[abs:restart]');
	}, 60_000);

	test('the default locale’s, handed to defineI18n as a value, is the new one', async () => {
		const output = edit('en.ts', "export default { hello: 'Howdy' };\n");

		expect(await becomes('/hello', 'Howdy')).toBe('Howdy');
		expect(output()).not.toContain('[abs:restart]');
	}, 60_000);

	/* Imported as a module, so this process holds the old one: the
	 * server is asked to restart, as it is for any file read once. Under
	 * `absolute dev` the CLI does; here there is no CLI above the
	 * server, so the request is what is observed. */
	test('a JSON catalog imported as a module asks for a restart', async () => {
		const output = edit('es.json', '{ "hello": "Buenas" }\n');
		const asked = async (attempt = 0): Promise<boolean> => {
			if (output().includes('[abs:restart]')) return true;
			if (attempt >= 40) return false;
			await Bun.sleep(250);

			return asked(attempt + 1);
		};

		expect(await asked()).toBe(true);
	}, 60_000);
});
