import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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

/* A Svelte component with no `<script>` block, imported into a page, must
 * pass `absolute typecheck`. svelte-check gives such a component the JS
 * script kind, so a project tsconfig without `allowJs` (the scaffolded one)
 * failed the import with TS7016 "Could not find a declaration file".
 *
 * The tsconfig here is the scaffolded one, not the repo's: the repo's
 * `types/` ships an ambient `declare module '*.svelte'` that hides the bug. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const HOME_PAGE = `<script lang="ts">
	import HmrLabel from '../components/HmrLabel.svelte';

	let { cssPath }: { cssPath: string } = $props();
</script>

<link rel="stylesheet" href={cssPath} />
<HmrLabel />
`;

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
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-svelte-scriptless-'));
	await mkdir(join(projectRoot, 'src', 'svelte', 'pages'), {
		recursive: true
	});
	await mkdir(join(projectRoot, 'src', 'svelte', 'components'), {
		recursive: true
	});
	await symlink(
		join(repoRoot, 'node_modules'),
		join(projectRoot, 'node_modules')
	);
	await writeFile(
		join(projectRoot, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				esModuleInterop: true,
				forceConsistentCasingInFileNames: true,
				jsx: 'react-jsx',
				module: 'ESNext',
				moduleResolution: 'bundler',
				noUncheckedIndexedAccess: true,
				rootDirs: ['.', '.absolutejs/types/svelte'],
				skipLibCheck: true,
				strict: true,
				target: 'ESNext'
			},
			exclude: ['node_modules', 'build', 'dist', '.absolutejs']
		})
	);
	await writeFile(
		join(projectRoot, 'absolute.config.ts'),
		"export default { svelteDirectory: 'src/svelte' };\n"
	);
	await writeFile(
		join(projectRoot, 'src', 'svelte', 'components', 'HmrLabel.svelte'),
		'<span class="label">hmr</span>\n'
	);
	await writeFile(
		join(projectRoot, 'src', 'svelte', 'pages', 'Home.svelte'),
		HOME_PAGE
	);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: Svelte components without a script block', () => {
	test('importing one into a page passes', async () => {
		const { exitCode, output } = await typecheck();

		expect(output).not.toContain('Could not find a declaration file');
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);

		// Its generated declaration is a complete TypeScript one, not the
		// JavaScript-mode output that names SvelteComponent without importing it.
		const declaration = await readFile(
			join(
				projectRoot,
				'.absolutejs',
				'types',
				'svelte',
				'src',
				'svelte',
				'components',
				'HmrLabel.svelte.d.ts'
			),
			'utf8'
		);
		expect(declaration).toContain('export default HmrLabel');
		expect(declaration).not.toMatch(/=\s*SvelteComponent</);
	}, 180_000);
});
