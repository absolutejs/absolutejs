import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/* `absolute links` — the command half of the dead-link check.
 *
 * A command as well as a build warning because the two answer different
 * questions. A production build already runs the route-registration scan
 * for the sitemap, so the warning rides along there for almost nothing;
 * but a warning in a build log is not a gate, and this exits non-zero so
 * CI can fail a branch on a dead link.
 *
 * Driven through the real CLI rather than by calling `auditLinks`, which
 * the unit test already does: what is being checked here is that the
 * command loads the project's own config (so `links.ignore` and the
 * framework directories are the project's), and that the exit code is
 * usable as a gate. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const write = (path: string, contents: string) =>
	mkdir(dirname(join(projectRoot, path)), { recursive: true }).then(() =>
		writeFile(join(projectRoot, path), contents)
	);

const runLinks = async () => {
	const proc = Bun.spawn(['bun', CLI_PATH, 'links'], {
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

const CONFIG = (extra = '') => `export default {
	fileRoutes: true,
	reactDirectory: 'src/react'${extra}
};
`;

beforeAll(async () => {
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-links-cmd-'));
	await symlink(
		join(repoRoot, 'node_modules'),
		join(projectRoot, 'node_modules')
	);
	await write('absolute.config.ts', CONFIG());
	await write(
		'src/react/routes/pricing.tsx',
		'export default function Pricing() {\n\treturn null;\n}\n'
	);
	await write('server.ts', `new Elysia().get('/legacy', () => 'x');\n`);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute links', () => {
	test('passes when every link is served', async () => {
		await write(
			'src/Nav.tsx',
			`export const Nav = () => (
	<nav>
		<a href="/pricing">a</a>
		<a href="/legacy">b</a>
		<a href="https://example.com">c</a>
		<a href="/brochure.pdf">d</a>
	</nav>
);
`
		);
		const { exitCode, output } = await runLinks();

		expect(output).toContain('No dead links');
		expect(exitCode).toBe(0);
	}, 120_000);

	test('names the file and line, and exits non-zero', async () => {
		await write(
			'src/Nav.tsx',
			`export const Nav = () => (
	<nav>
		<a href="/pricing">a</a>
		<a href="/pricng">b</a>
	</nav>
);
`
		);
		const { exitCode, output } = await runLinks();

		expect(output).toContain('src/Nav.tsx:4 → /pricng');
		expect(exitCode).toBe(1);
	}, 120_000);

	/* The project's own config is what the command reads, which is the
	 * reason this goes through the CLI: a route an installed plugin mounts
	 * is invisible to the scan, and `links.ignore` is how an app says so. */
	test('honours links.ignore from the project config', async () => {
		await write(
			'src/Nav.tsx',
			'export const Nav = () => <a href="/auth/sign-in">in</a>;\n'
		);
		const before = await runLinks();

		expect(before.exitCode).toBe(1);

		await write(
			'absolute.config.ts',
			CONFIG(",\n\tlinks: { ignore: ['/auth/*'] }")
		);
		const after = await runLinks();

		expect(after.output).toContain('No dead links');
		expect(after.exitCode).toBe(0);
	}, 120_000);
});
