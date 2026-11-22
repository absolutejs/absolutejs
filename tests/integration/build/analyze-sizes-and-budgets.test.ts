import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/* Two things that go wrong quietly.
 *
 * A manifest value is either a web path (`/chunk-x.js`, served from the
 * build directory) or an absolute filesystem path (a server bundle the
 * project's own server `import`s). Both start with `/`, and `analyze`
 * stripped that and joined under the build directory, so every server
 * entry resolved to a path that does not exist and was sized as 0.
 * Measured on this repository's example app: 14 of 57 entries read zero,
 * hiding 2,477 KB — including the two largest things in the build. The
 * report claimed 705 KB for a 3.2 MB build and printed `Pages 346 B`.
 *
 * And a budget gate that reads those numbers is worse than no gate: it
 * passes while the thing it guards grows. */

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI = join(REPO_ROOT, 'src', 'cli', 'index.ts');
const root = join(REPO_ROOT, '.test-builds', `analyze-${process.pid}`);

const run = async (args: string[]) => {
	const child = Bun.spawn(['bun', CLI, ...args], {
		cwd: root,
		env: { ...process.env, FORCE_COLOR: '0', TELEMETRY_OFF: '1' },
		stderr: 'pipe',
		stdout: 'pipe'
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text()
	]);

	return { exitCode, output: `${stdout}\n${stderr}`, stdout };
};

const writeConfig = async (budgets?: string) => {
	await writeFile(
		join(root, 'absolute.config.ts'),
		`import { defineConfig } from ${JSON.stringify(join(REPO_ROOT, 'src', 'utils', 'defineConfig.ts'))};\n\nexport default defineConfig({\n\tbuildDirectory: 'build',\n\tsvelteDirectory: 'svelte'${budgets === undefined ? '' : `,\n\tsizeBudgets: ${budgets}`}\n});\n`
	);
};

beforeAll(async () => {
	await mkdir(join(root, 'svelte', 'pages'), { recursive: true });
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({ name: 'analyze-fixture' })
	);
	/* Svelte, because its page entry is a SERVER bundle recorded in the
	 * manifest as an absolute filesystem path — the shape that used to
	 * size as zero. */
	await writeFile(
		join(root, 'svelte', 'pages', 'Home.svelte'),
		'<script>\n\tlet count = 0;\n</script>\n\n<h1>Home {count}</h1>\n'
	);
	await writeConfig();
	const built = await run(['build']);
	expect({ code: built.exitCode, out: built.output }).toMatchObject({
		code: 0
	});
}, 180_000);

afterAll(async () => {
	await rm(root, { force: true, recursive: true });
});

describe('absolute analyze', () => {
	test('sizes a server entry recorded as an absolute path', async () => {
		const { stdout } = await run(['analyze', '--json']);
		const sizes: Record<string, number> = JSON.parse(stdout);
		const manifest: Record<string, string> = await Bun.file(
			join(root, 'build', 'manifest.json')
		).json();

		/* Every entry whose file is really on disk has a non-zero size,
		 * whichever of the two path shapes the manifest used. */
		for (const [key, value] of Object.entries(manifest)) {
			const candidates = [
				join(root, 'build', value.replace(/^\//, '')),
				value
			];
			const onDisk = candidates
				.map((path) => {
					try {
						return statSync(path).size;
					} catch {
						return null;
					}
				})
				.find((size) => size !== null);
			if (onDisk === undefined || onDisk === 0) continue;
			expect({ key, size: sizes[key] }).toEqual({ key, size: onDisk });
		}
	}, 180_000);

	test('the total is the sum of what it sized', async () => {
		const { stdout } = await run(['analyze', '--json']);
		const sizes: Record<string, number> = JSON.parse(stdout);
		const sum = Object.values(sizes).reduce((carry, size) => carry + size, 0);

		expect(sum).toBeGreaterThan(0);
		const report = await run(['analyze']);
		expect(report.output).toContain('Total');
	}, 180_000);
});

describe('absolute analyze --check', () => {
	test('says so, and passes, when no budgets are configured', async () => {
		await writeConfig();
		const { exitCode, output } = await run(['analyze', '--check']);

		expect(output).toContain('No size budgets set');
		expect(exitCode).toBe(0);
	}, 180_000);

	/* A gate that prints nothing when it passes cannot be told apart from
	 * a gate that never ran, which is how a budget quietly stops being
	 * enforced. */
	test('reports a met budget rather than staying silent', async () => {
		await writeConfig(`{ total: '100mb' }`);
		const { exitCode, output } = await run(['analyze', '--check']);

		expect(output).toContain('total');
		expect(output).toContain('100.0 MB');
		expect(exitCode).toBe(0);
	}, 180_000);

	test('fails with a non-zero exit when the total is over', async () => {
		await writeConfig(`{ total: '1kb' }`);
		const { exitCode, output } = await run(['analyze', '--check']);

		expect(output).toMatch(/over 1 KB by/u);
		expect(exitCode).toBe(1);
	}, 180_000);

	test('fails on a per-entry budget, which is what catches one huge page', async () => {
		await writeConfig(`{ perEntry: '1b' }`);
		const { exitCode, output } = await run(['analyze', '--check']);

		expect(exitCode).toBe(1);
		expect(output).toContain('over 1 B');
	}, 180_000);

	/* Unreadable, not unenforced. */
	test('fails on a budget it cannot read, naming it', async () => {
		await writeConfig(`{ total: 'quite small' }`);
		const { exitCode, output } = await run(['analyze', '--check']);

		expect(output).toContain('is not a size');
		expect(output).toContain('quite small');
		expect(exitCode).toBe(1);
	}, 180_000);
});
