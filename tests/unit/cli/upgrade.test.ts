import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/* `absolute upgrade` — the entry point the migrations never had.
 *
 * A disruptive changelog entry can declare a migration, and
 * `@absolutejs/changelog` exports the whole apparatus for applying one, but
 * nothing in this CLI read them: a project several versions behind had to
 * read every entry to find out what its own code needed.
 *
 * Driven through the real CLI against a project pinned to an old version,
 * because the parts worth testing are the ones a unit test of the library
 * cannot see — which version it decides to upgrade FROM, that a dry run
 * writes nothing, and that a real run edits both the manifest and the
 * source.
 *
 * It reaches the npm registry, so it is skipped when that is unavailable
 * rather than failing a build for a network outage. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');

/** A version far enough back to have migrations after it, and published. */
const FROM = '0.20.0-beta.140';
const TO = '0.20.0-beta.291';

const roots: string[] = [];

const makeProject = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), 'absolute-upgrade-'));
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

const HOOKS = `import { Elysia } from 'elysia';

export const app = new Elysia()
	.beforeHandle(({ request }) => console.log(request.url))
	.afterHandle(({ response }) => response)
	.get('/', () => 'ok');
`;

const project = (version = FROM) => ({
	'node_modules/@absolutejs/absolute/package.json': JSON.stringify({
		name: '@absolutejs/absolute',
		version
	}),
	'package.json': JSON.stringify({
		dependencies: { '@absolutejs/absolute': version, elysia: '1.4.0' },
		name: 'behind-app',
		private: true
	}),
	'src/hooks.ts': HOOKS
});

const run = async (root: string, ...args: string[]) => {
	const proc = Bun.spawn(['bun', CLI_PATH, 'upgrade', ...args], {
		cwd: root,
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

const online = await fetch('https://registry.npmjs.org/@absolutejs/absolute', {
	signal: AbortSignal.timeout(10_000)
})
	.then((response) => response.ok)
	.catch(() => false);

describe.skipIf(!online)('absolute upgrade', () => {
	test('reports the manual migrations with the release that introduced each', async () => {
		const root = await makeProject(project());
		const { exitCode, output } = await run(root, '--to', TO, '--dry-run');

		expect(output).toContain(`${FROM} → ${TO}`);
		expect(output).toContain('need');
		// Each instruction is attributed, so a reader can find the entry.
		expect(output).toContain('0.20.0-beta.191');
		expect(exitCode).toBe(0);
	}, 180_000);

	/* The two halves a machine can do: a dependency range in the manifest
	 * and a rename in the source. */
	test('a real run edits the manifest and the source', async () => {
		const root = await makeProject(project());
		const { exitCode, output } = await run(root, '--to', TO);
		const manifest = await readFile(join(root, 'package.json'), 'utf-8');
		const hooks = await readFile(join(root, 'src/hooks.ts'), 'utf-8');

		expect(exitCode).toBe(0);
		expect(output).toContain('changed package.json');
		expect(manifest).toContain('2.0.0-rc.0');
		expect(hooks).toContain('.onBeforeHandle(');
		expect(hooks).toContain('.onAfterHandle(');
		expect(hooks).not.toContain('\t.beforeHandle(');
	}, 180_000);

	test('a dry run writes nothing', async () => {
		const root = await makeProject(project());
		const { output } = await run(root, '--to', TO, '--dry-run');
		const manifest = await readFile(join(root, 'package.json'), 'utf-8');
		const hooks = await readFile(join(root, 'src/hooks.ts'), 'utf-8');

		const dependencies: { dependencies: Record<string, string> } =
			JSON.parse(manifest);

		expect(output).toContain('Nothing was written');
		expect(dependencies.dependencies.elysia).toBe('1.4.0');
		expect(hooks).toBe(HOOKS);
	}, 180_000);

	/* The version it upgrades FROM is the one actually installed, not
	 * whatever the manifest range allows — those disagree in any project
	 * that has not reinstalled. */
	test('reads the installed version, not the declared range', async () => {
		const root = await makeProject({
			...project(),
			'node_modules/@absolutejs/absolute/package.json': JSON.stringify({
				name: '@absolutejs/absolute',
				version: '0.20.0-beta.250'
			})
		});
		const { output } = await run(root, '--to', TO, '--dry-run');

		expect(output).toContain(`0.20.0-beta.250 → ${TO}`);
		expect(output).not.toContain(FROM);
	}, 180_000);

	test('says so when there is nothing to do', async () => {
		const root = await makeProject(project(TO));
		const { exitCode, output } = await run(root, '--to', TO);

		expect(output).toContain('already the target');
		expect(exitCode).toBe(0);
	}, 180_000);

	test('fails clearly when the package is not installed', async () => {
		const root = await makeProject({
			'package.json': JSON.stringify({ name: 'bare', private: true })
		});
		const { exitCode, output } = await run(root, '--to', TO);

		expect(output).toContain('is not installed in this project');
		expect(exitCode).toBe(1);
	}, 180_000);
});
