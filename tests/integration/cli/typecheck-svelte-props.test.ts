import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* `handleSveltePageRequest<typeof Page>({ props })` in a server file must
 * check props against the component's real `$props()` type, as
 * `handleReactPageRequest` does. Svelte's ambient `*.svelte` module typed
 * every import as an any-props component; `absolute typecheck` now generates
 * per-component declarations (svelte2tsx) and resolves server imports to
 * them through `rootDirs`.
 *
 * The fixture lives in the OS temp directory: the repo's own tsconfig
 * includes tests/**, so a fixture with deliberate errors can't sit there. It
 * extends the repo tsconfig and imports the handler from source, the way the
 * repo itself typechecks it. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const PRICING_PAGE = `<script lang="ts">
	let { cssPath }: { cssPath: string } = $props();
</script>

<link rel="stylesheet" href={cssPath} />
`;

const writeServer = (props: string) =>
	writeFile(
		join(projectRoot, 'src', 'server.ts'),
		`import { handleSveltePageRequest } from ${JSON.stringify(join(repoRoot, 'src', 'svelte', 'pageHandler'))};
import type Pricing from './svelte/pages/Pricing.svelte';

export const pricing = () =>
	handleSveltePageRequest<typeof Pricing>({
		indexPath: '',
		pagePath: '',
		props: ${props}
	});
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
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-svelte-props-'));
	await mkdir(join(projectRoot, 'src', 'svelte', 'pages'), {
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
		"export default { svelteDirectory: 'src/svelte' };\n"
	);
	await writeFile(
		join(projectRoot, 'src', 'svelte', 'pages', 'Pricing.svelte'),
		PRICING_PAGE
	);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: Svelte page props in server files', () => {
	test('a missing prop fails with TS2741', async () => {
		await writeServer('{}');
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2741');
		expect(output).toContain("Property 'cssPath' is missing");
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('a wrongly typed prop fails with TS2322', async () => {
		await writeServer('{ cssPath: 1 }');
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2322');
		expect(output).toContain(
			"Type 'number' is not assignable to type 'string'"
		);
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('an unknown prop fails with TS2353', async () => {
		await writeServer("{ bogus: true, cssPath: '/pricing.css' }");
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2353');
		expect(output).toContain("'bogus' does not exist");
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('correct props pass, and the declaration the editor resolves is on disk', async () => {
		await writeServer("{ cssPath: '/pricing.css' }");
		const { exitCode, output } = await typecheck();
		const declarationPath = join(
			projectRoot,
			'.absolutejs',
			'types',
			'svelte',
			'src',
			'svelte',
			'pages',
			'Pricing.svelte.d.ts'
		);

		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
		expect(existsSync(declarationPath)).toBe(true);
		expect(await readFile(declarationPath, 'utf8')).toContain(
			'cssPath: string'
		);
		// The project's tsconfig has no rootDirs entry, so the editor hint shows.
		expect(output).toContain('.absolutejs/types/svelte');
	}, 180_000);
});
