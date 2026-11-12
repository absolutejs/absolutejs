import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ensureDistBuild } from '../../helpers/ensureDistBuild';

/* `useServerData` types `data` from the fetcher's return type, and
 * `absolute typecheck` (vue-tsc) must hold a `.vue` page to it. The fixture
 * lives in the OS temp directory because the repo tsconfig includes tests/**
 * and the negative case is a deliberate type error. It imports
 * `@absolutejs/absolute/vue` the way an app does, mapped to this checkout's
 * published declarations: the generated vue-tsc config pins rootDir to the
 * project, so importing the repo's sources would fail with TS6059. */

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const CLI_PATH = join(repoRoot, 'src', 'cli', 'index.ts');
let projectRoot = '';

const writePage = (usage: string) =>
	writeFile(
		join(projectRoot, 'src', 'vue', 'pages', 'Profile.vue'),
		`<script setup lang="ts">
import { useServerData } from '@absolutejs/absolute/vue';

type Profile = { id: number; name: string };

const loadProfile = async (_signal: AbortSignal) => {
	const profile: Profile = { id: 1, name: 'Ada' };

	return profile;
};

const { data, error, pending, refresh } = useServerData('profile', loadProfile);
${usage}
</script>

<template>
	<p v-if="pending">Loading</p>
	<p v-else-if="error">{{ error.message }}</p>
	<button v-else type="button" @click="refresh">{{ data?.name }}</button>
</template>
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
	projectRoot = await mkdtemp(join(tmpdir(), 'absolute-vue-server-data-'));
	await mkdir(join(projectRoot, 'src', 'vue', 'pages'), { recursive: true });
	await symlink(
		join(repoRoot, 'node_modules'),
		join(projectRoot, 'node_modules')
	);
	await writeFile(
		join(projectRoot, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				paths: {
					'@absolutejs/absolute/vue': [
						join(repoRoot, 'dist', 'src', 'vue', 'index.d.ts')
					]
				}
			},
			exclude: [],
			extends: join(repoRoot, 'tsconfig.json'),
			files: [],
			include: ['src']
		})
	);
	await writeFile(
		join(projectRoot, 'absolute.config.ts'),
		"export default { vueDirectory: 'src/vue' };\n"
	);
});

afterAll(async () => {
	if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
});

describe('absolute typecheck: useServerData in a Vue page', () => {
	test('typed usage of data passes', async () => {
		await writePage(
			'const name: string | undefined = data.value?.name;\nconst failure: Error | null = error.value;\nvoid name;\nvoid failure;'
		);
		const { exitCode, output } = await typecheck();

		expect(output).not.toMatch(/error\S*\s*TS\d+/);
		expect(output).toContain('Typecheck passed');
		expect(exitCode).toBe(0);
	}, 300_000);

	test('treating data as the wrong type fails', async () => {
		await writePage('const id: string = data.value?.id ?? "";\nvoid id;');
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2322');
		expect(output).toContain(
			"Type 'number' is not assignable to type 'string'"
		);
		expect(exitCode).not.toBe(0);
	}, 180_000);

	test('reading a property the fetcher does not return fails', async () => {
		await writePage('const email = data.value?.email;\nvoid email;');
		const { exitCode, output } = await typecheck();

		expect(output).toContain('TS2339');
		expect(output).toContain("Property 'email' does not exist");
		expect(exitCode).not.toBe(0);
	}, 180_000);
});
