import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { build } from '../../../src/core/build';

/* The boundary through a real `build()`, not just the plugins: what makes
 * item 0.7 a fix is that these failures reach the build's own error path.
 * A failed build throws, so the message reaches the caller; `throwOnError`
 * is kept on these cases because they predate that and the flag is now
 * only about escalating survivable warnings. */

const tempDirs: string[] = [];
const testBuildRoot = join(
	resolve(import.meta.dir, '..', '..', '..'),
	'.test-builds'
);

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { force: true, recursive: true });
	}
});

/** A React project whose page imports `client/secrets.ts`. */
const project = async (name: string, secretsSource: string) => {
	await mkdir(testBuildRoot, { recursive: true });
	const fixtureRoot = await mkdtemp(join(testBuildRoot, `absolute-${name}-`));
	tempDirs.push(fixtureRoot);
	const reactRoot = join(fixtureRoot, 'react');
	await mkdir(join(reactRoot, 'client'), { recursive: true });
	await mkdir(join(reactRoot, 'pages'), { recursive: true });
	await writeFile(join(reactRoot, 'client', 'secrets.ts'), secretsSource);
	await writeFile(
		join(reactRoot, 'pages', 'Home.tsx'),
		`import { value } from '../client/secrets';
export function Home() {
	return <div>{value}</div>;
}`
	);

	return {
		buildDirectory: join(fixtureRoot, 'build'),
		cwd: fixtureRoot,
		reactDirectory: reactRoot
	};
};

const failure = async (promise: Promise<unknown>) => {
	try {
		await promise;

		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

describe('a server module reaching a client bundle', () => {
	test('fails the build and names the file holding the import', async () => {
		const config = await project(
			'server-only',
			`import '@absolutejs/absolute/server-only';
export const value = 'from the database';`
		);
		const message = await failure(
			build({
				...config,
				mode: 'production',
				options: { throwOnError: true }
			})
		);

		expect(message).toBeDefined();
		expect(message).toContain('server-only');
		expect(message).toContain('secrets.ts');
	});
});

describe('process.env in client code', () => {
	test('fails a production build, with the file and line', async () => {
		const config = await project(
			'process-env',
			`export const value = process.env.API_URL ?? '';`
		);
		const message = await failure(
			build({
				...config,
				mode: 'production',
				options: { throwOnError: true }
			})
		);

		expect(message).toBeDefined();
		expect(message).toContain('process.env.API_URL');
		expect(message).toContain('secrets.ts');
	});

	test("'off' builds it anyway", async () => {
		const config = await project(
			'process-env-off',
			`export const value = process.env.API_URL ?? '';`
		);

		expect(
			await failure(
				build({
					...config,
					clientBoundary: { processEnv: 'off' },
					mode: 'production',
					options: { throwOnError: true }
				})
			)
		).toBeUndefined();
	});

	test('NODE_ENV builds, because Bun substitutes it', async () => {
		// The one key that neither crashes nor leaks — and the thing a
		// blanket ban on `process.env` would have broken for every project
		// that picks a code path by it.
		const config = await project(
			'process-env-node-env',
			`export const value = process.env.NODE_ENV === 'production' ? 'live' : 'local';`
		);

		expect(
			await failure(
				build({
					...config,
					mode: 'production',
					options: { throwOnError: true }
				})
			)
		).toBeUndefined();
	});
});
