import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `route()` is only worth having if the paths and params are actually
 * checked, and that cannot be asserted from inside a passing test file —
 * a type error is a compile failure, not a value. So this drives
 * `absolute typecheck` over a fixture and reads the diagnostics.
 *
 * It is also the only test of the whole chain: the command derives the
 * project's routes from its source tree, writes
 * `.absolutejs/types/routes.d.ts`, merges it into the package's
 * `AbsoluteRouteMap`, and `route()`'s types read it from there. A break
 * anywhere along that chain means `route()` silently accepts everything,
 * which no unit test of either end would notice.
 *
 * Resolved through `node_modules/@absolutejs/absolute` and its published
 * declarations, the way an app resolves it, so a stale `dist` is the
 * thing to suspect if this fails for no visible reason —
 * `ensureDistBuild` only checks that one exists. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const writeCaller = (body: string) =>
	writeFile(
		join(projectRoot, 'src', 'links.ts'),
		`import { route } from '@absolutejs/absolute';

${body}
`
	);

const typecheck = async () => {
	const proc = Bun.spawn(['bun', CLI_PATH, 'typecheck'], {
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

beforeAll(async () => {
	await ensureDistBuild();
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-route-map-types-'));
	await mkdir(join(projectRoot, 'src', 'react', 'routes', 'blog'), {
		recursive: true
	});
	await symlink(
		join(repoRoot, 'node_modules'),
		join(projectRoot, 'node_modules')
	);
	await writeFile(
		join(projectRoot, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: { rootDir: '/' },
			exclude: [],
			extends: join(repoRoot, 'tsconfig.json'),
			files: [],
			include: ['src', join(repoRoot, 'types', '**', '*.d.ts')]
		})
	);
	await writeFile(
		join(projectRoot, 'absolute.config.ts'),
		"export default { fileRoutes: true, reactDirectory: 'src/react' };\n"
	);
	await writeFile(
		join(projectRoot, 'src', 'react', 'routes', 'pricing.tsx'),
		'export default function Pricing() {\n\treturn null;\n}\n'
	);
	await writeFile(
		join(projectRoot, 'src', 'react', 'routes', 'blog', '[slug].tsx'),
		'export default function Post() {\n\treturn null;\n}\n'
	);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: route() against the generated route map', () => {
	test('the project’s own paths and params pass', async () => {
		await writeCaller(`export const links = [
	route('/pricing'),
	route('/blog/:slug', { slug: 'hello' }),
	route('/blog/:slug', { slug: 7 })
];`);
		const { exitCode, output } = await typecheck();

		expect(output).not.toContain('TS2');
		expect(exitCode).toBe(0);
	}, 180_000);

	/* The assertion that matters: a path no route serves. This is the
	 * error a plain `href` string cannot produce, and the reason the route
	 * map is generated at all. */
	test('a path no route serves is an error', async () => {
		await writeCaller("export const link = route('/pricng');");
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2345');
		expect(output).toContain('"/pricng"');
		/* The message has to LIST the project's routes, which is what
		 * makes it actionable and is why `AbsoluteRoutePath` is written as
		 * an indexed access rather than an `Extract` — that printed only
		 * "not assignable to parameter of type 'keyof AbsoluteRouteMap'".
		 * Equally, the params type has to stay permissive for a path that
		 * is not a route, or this reads "Expected 2 arguments, but got 1"
		 * and never mentions the path at all. */
		expect(output).toContain('"/blog/:slug" | "/pricing"');
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('a missing param is an error', async () => {
		await writeCaller("export const link = route('/blog/:slug');");
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2554');
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('a misspelled param is an error', async () => {
		await writeCaller(
			"export const link = route('/blog/:slug', { slgu: 'x' });"
		);
		const { exitCode, output } = await typecheck();

		expect(output).toContain('slgu');
		expect(exitCode).not.toBe(0);
	}, 180_000);

	/* A param for a path that has none: caught, because the arg list for
	 * such a path is empty rather than loosely typed. */
	test('params for a path that takes none is an error', async () => {
		await writeCaller(
			"export const link = route('/pricing', { slug: 'x' });"
		);
		const { exitCode, output } = await typecheck();

		expect(exitCode).not.toBe(0);
		expect(output).toContain('TS2554');
	}, 180_000);
});
