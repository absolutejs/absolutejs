import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `FileRouteDerivedContext` is filled in by the app, through declaration
 * merging:
 *
 *   declare module '@absolutejs/absolute' {
 *     interface FileRouteDerivedContext { session: Session | null }
 *   }
 *
 * and every route's `load` then sees `session` typed. The reason this is
 * a test rather than a line in the docs: merging has to reach an
 * interface the package only RE-EXPORTS. `@absolutejs/absolute` exports
 * `*` from `types/index.ts`, which exports `*` from `types/fileRoutes.ts`,
 * where the interface is declared — and an augmentation of a module that
 * merely re-exports a type can land in that module's own scope instead,
 * leaving the original untouched and the whole feature silently inert. It
 * works today; it would stop working if the type moved or the barrel
 * changed, and nothing else would notice.
 *
 * Resolved through `node_modules/@absolutejs/absolute` and its published
 * declarations, which is how a real app resolves it and the only
 * configuration where the augmentation means anything. That makes a stale
 * `dist` the thing to suspect if this fails for no visible reason —
 * `ensureDistBuild` only checks that one exists.
 *
 * A `paths` alias onto the source was tried instead, to be immune to
 * that, and is wrong twice over: it puts the framework's own
 * implementation in the program, which cannot prove it supplies keys the
 * app declared (so the context construction reports an error no app ever
 * sees), and it gives the generated route module a second copy of every
 * type — `dist/types/fileRoutes` and `types/fileRoutes` as different
 * modules. Both are artefacts of the harness, not of the feature. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const AUGMENTATION = `declare module '@absolutejs/absolute' {
	interface FileRouteDerivedContext {
		session: { user: string } | null;
	}
}
`;

const writeServerModule = (augmented: boolean, body: string) =>
	writeFile(
		join(projectRoot, 'src', 'react', 'routes', 'account.server.ts'),
		`import type { FileRouteContext } from '@absolutejs/absolute';

${augmented ? AUGMENTATION : ''}
${body}
`
	);

const READS_SESSION = `export const load = ({ session }: FileRouteContext<'/account'>) => ({
	user: session?.user ?? 'anonymous'
});`;

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
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-derived-context-'));
	await mkdir(join(projectRoot, 'src', 'react', 'routes'), {
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
		join(projectRoot, 'src', 'react', 'routes', 'account.tsx'),
		'export default function Account() {\n\treturn null;\n}\n'
	);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: plugin-derived context in file routes', () => {
	/* The negative case first, because it is what makes the positive one
	 * mean something: if the context allowed any key, both would pass and
	 * the test would prove nothing. */
	test('a derived key an app has not declared is an error', async () => {
		await writeServerModule(false, READS_SESSION);
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2339');
		expect(output).toContain("Property 'session' does not exist");
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('declaring it on the package entry types it in every load', async () => {
		await writeServerModule(true, READS_SESSION);
		const { exitCode, output } = await typecheck();

		expect(output).not.toContain('TS2339');
		expect(exitCode).toBe(0);
	}, 180_000);

	/* Declared means typed, not merely present: the value has the shape
	 * the app gave it. */
	test('the declared type is enforced, not widened', async () => {
		await writeServerModule(
			true,
			`export const load = ({ session }: FileRouteContext<'/account'>) => ({
	user: session?.user.length ?? 0,
	wrong: session?.user.toFixed(2)
});`
		);
		const { exitCode, output } = await typecheck();

		/* TS2551, not TS2339: `string` has a `fixed` method, so this is
		 * the "did you mean" variant. Asserting the message as well,
		 * because the code alone would also match a typo somewhere else
		 * in the fixture. */
		expect(output).toContain('TS2551');
		expect(output).toContain(
			"Property 'toFixed' does not exist on type 'string'"
		);
		expect(exitCode).not.toBe(0);
	}, 180_000);
});
