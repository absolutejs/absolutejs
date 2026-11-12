import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* An HTML page and an HTMX page with the same file name share a manifest
 * key (`asset(manifest, 'Home')`). beta.168 only warned "Manifest key
 * collision … overwritten", and both routes then served whichever page was
 * processed last. It is now a build error naming both source files. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const fixtures: string[] = [];

const createProject = async (name: string, htmxPage: string) => {
	const root = join(
		repoRoot,
		'.test-builds',
		`manifest-collision-${name}-${process.pid}`
	);
	fixtures.push(root);
	await mkdir(join(root, 'html', 'pages'), { recursive: true });
	await mkdir(join(root, 'htmx', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'html', 'pages', 'Home.html'),
		'<!doctype html><html><head><title>html</title></head><body>html home</body></html>\n'
	);
	await writeFile(
		join(root, 'htmx', 'pages', htmxPage),
		'<!doctype html><html><head><title>htmx</title></head><body>htmx home</body></html>\n'
	);
	await writeFile(
		join(root, 'build.ts'),
		`import { build } from ${JSON.stringify(join(repoRoot, 'src', 'core', 'build.ts'))};

const result = await build({
	buildDirectory: 'build',
	htmlDirectory: 'html',
	htmxDirectory: 'htmx',
	mode: 'production',
	options: { throwOnError: true }
});
console.log(JSON.stringify(result?.manifest ?? {}));
`
	);

	return root;
};

const runBuild = async (root: string) => {
	const proc = Bun.spawn(['bun', join(root, 'build.ts')], {
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

	return { exitCode, output: `${stdout}\n${stderr}`, stdout };
};

afterAll(async () => {
	await Promise.all(
		fixtures.map((root) => rm(root, { force: true, recursive: true }))
	);
});

describe('manifest key collisions', () => {
	test('an HTML and an HTMX page with the same name fail the build', async () => {
		const root = await createProject('same', 'Home.html');
		const { exitCode, output } = await runBuild(root);

		expect(exitCode).not.toBe(0);
		expect(output).toContain('Manifest key "Home" belongs to two pages');
		expect(output).toContain(join('html', 'pages', 'Home.html'));
		expect(output).toContain(join('htmx', 'pages', 'Home.html'));
		expect(output).toContain('HomePage.html');
	}, 120_000);

	test('distinct names still build', async () => {
		const root = await createProject('distinct', 'HtmxHome.html');
		const { exitCode, output, stdout } = await runBuild(root);

		expect(output).not.toContain('Manifest key');
		expect(exitCode).toBe(0);
		const manifest: Record<string, string> = JSON.parse(
			stdout.trim().split('\n').at(-1) ?? '{}'
		);
		expect(manifest.Home).toContain(join('html', 'pages', 'Home.html'));
		expect(manifest.HtmxHome).toContain(
			join('htmx', 'pages', 'HtmxHome.html')
		);
	}, 120_000);
});
