import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { MANIFEST_KEYS_DECLARATION } from '../../../src/build/manifestKeys';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `asset(manifest, key)` accepted any string, so `asset(manifest, 'Abuot')`
 * passed typecheck and failed at runtime. `absolute typecheck` now derives
 * the project's manifest keys from its source tree (no build) into
 * .absolutejs/types/manifest.d.ts, which narrows `asset`'s key. A project
 * without that file (one that never ran an AbsoluteJS command) must still
 * compile with any string, and `assetUnchecked` takes a key computed at
 * runtime. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const COMPILER_OPTIONS: Record<string, string | string[] | boolean> = {
	jsx: 'react-jsx',
	lib: ['DOM', 'DOM.Iterable', 'ESNext'],
	module: 'ESNext',
	moduleResolution: 'bundler',
	skipLibCheck: true,
	strict: true,
	target: 'ESNext',
	types: ['bun']
};

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

const writeServer = (key: string) =>
	write(
		'src/server.ts',
		`import { asset, assetUnchecked } from '@absolutejs/absolute';

declare const manifest: Record<string, string>;
declare const pageName: string;

export const home = asset(manifest, ${JSON.stringify(key)});
export const about = asset(manifest, 'about');
export const styles = asset(manifest, 'GlobalCSS');
export const computed = assetUnchecked(manifest, \`\${pageName}Index\`);
`
	);

const run = async (command: string[]) => {
	const proc = Bun.spawn(command, {
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

const typecheck = () => run([process.execPath, CLI_PATH, 'typecheck']);

beforeAll(async () => {
	await ensureDistBuild();
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-manifest-keys-'));
	await linkNodeModules();
	await write(
		'tsconfig.json',
		JSON.stringify({
			compilerOptions: COMPILER_OPTIONS,
			include: ['src']
		})
	);
	await write(
		'absolute.config.ts',
		"export default {\n\thtmlDirectory: 'src/html',\n\treactDirectory: 'src/react',\n\tstylesConfig: 'src/styles'\n};\n"
	);
	await write(
		'src/react/pages/Home.tsx',
		'export const Home = () => <h1>home</h1>;\n'
	);
	await write(
		'src/html/pages/about.html',
		'<!doctype html><html><body>about</body></html>\n'
	);
	await write('src/styles/global.css', 'body { margin: 0; }\n');
}, 300_000);

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: manifest keys', () => {
	test('a project without the generated declaration accepts any key', async () => {
		await writeServer('Abuot');
		expect(existsSync(join(projectRoot, MANIFEST_KEYS_DECLARATION))).toBe(
			false
		);
		const { exitCode, output } = await run([
			process.execPath,
			'check',
			'-p',
			'tsconfig.json'
		]);

		expect(output).not.toMatch(/TS\d{4}/);
		expect(exitCode).toBe(0);
	}, 300_000);

	test('the keys the build writes pass', async () => {
		await writeServer('HomeIndex');
		const { exitCode, output } = await typecheck();
		const declaration = await readFile(
			join(projectRoot, MANIFEST_KEYS_DECLARATION),
			'utf-8'
		);

		expect(declaration).toContain('"HomeIndex": true;');
		expect(declaration).toContain('"about": true;');
		expect(declaration).toContain('"GlobalCSS": true;');
		expect(output).not.toMatch(/TS\d{4}/);
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
	}, 300_000);

	test('a misspelled key is a type error', async () => {
		await writeServer('Abuot');
		const { exitCode, output } = await typecheck();

		expect(exitCode).not.toBe(0);
		expect(output).toContain('src/server.ts');
		expect(output).toContain('TS2345');
		expect(output).toContain('"Abuot"');
		expect(output.match(/TS2345/g)).toHaveLength(1);
	}, 300_000);

	/* The editor note said to add the declaration to `include`, but a
	 * tsconfig that excludes .absolutejs (every scaffold before beta.180)
	 * drops it from `include` again, so the editor never saw the keys. `tsc`
	 * itself, run as an editor would (the project's own tsconfig.json), shows
	 * which entry works: `files`, which `exclude` doesn't apply to. */
	test('the editor note names "files" when tsconfig excludes .absolutejs, and goes once it is listed', async () => {
		const tsc = () =>
			run([
				process.execPath,
				join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
				'-p',
				'tsconfig.json',
				'--noEmit'
			]);
		const writeTsconfig = (lists: Record<string, string[]>) =>
			write(
				'tsconfig.json',
				JSON.stringify({ compilerOptions: COMPILER_OPTIONS, ...lists })
			);
		await writeServer('Abuot');
		try {
			await writeTsconfig({
				exclude: ['node_modules', '.absolutejs'],
				include: ['src', MANIFEST_KEYS_DECLARATION]
			});
			const noted = await typecheck();
			expect(noted.output).toContain(
				`"files": ["${MANIFEST_KEYS_DECLARATION}"]`
			);
			// Following the old note: still no keys in the editor.
			expect((await tsc()).output).not.toContain('TS2345');

			await writeTsconfig({
				exclude: ['node_modules', '.absolutejs'],
				files: [MANIFEST_KEYS_DECLARATION],
				include: ['src']
			});
			const editor = await tsc();
			expect(editor.output).toContain('TS2345');
			expect(editor.output).toContain('"Abuot"');
			const quiet = await typecheck();
			expect(quiet.output).toContain('TS2345');
			expect(quiet.output).not.toContain('asset(manifest, key) keys');
		} finally {
			await writeTsconfig({ include: ['src'] });
		}
	}, 300_000);
});
