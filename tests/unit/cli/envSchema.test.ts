import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	readEnvSchema,
	resolveEnvModule
} from '../../../src/cli/scripts/envSchema';

/* `absolute env` knew one thing: a regex for `getEnv('X')`. A project
 * that declares its environment with `defineEnv` — the typed path, with
 * types, defaults and validation — got "No getEnv() usage found under
 * src/.", so the command said nothing at all for projects doing it the
 * recommended way. */

const DEFINE_ENV = resolve(import.meta.dir, '../../../src/utils/defineEnv.ts');

let directory = '';
let previousCwd = '';

beforeEach(async () => {
	/* Inside the repo so the fixture's `import { Type } from
	 * '@sinclair/typebox'` resolves from node_modules — a fixture in the
	 * OS temp directory cannot see it, and the import failure then looks
	 * exactly like the schema being unreadable. */
	directory = await mkdtemp(
		join(resolve(import.meta.dir, '../../..'), '.env-fixture-')
	);
	previousCwd = process.cwd();
	process.chdir(directory);
});

afterEach(async () => {
	process.chdir(previousCwd);
	await rm(directory, { force: true, recursive: true });
});

const writeEnvModule = async (path: string, body: string) => {
	await mkdir(join(directory, path, '..'), { recursive: true });
	await writeFile(
		join(directory, path),
		`import { Type } from '@sinclair/typebox';\nimport { defineEnv } from ${JSON.stringify(DEFINE_ENV)};\n${body}\n`
	);

	return join(directory, path);
};

describe('finding the env module', () => {
	test('src/env.ts, the layout the rest of the CLI assumes', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			'export const env = defineEnv({ PORT: Type.Number({ default: 3000 }) });'
		);

		expect(resolveEnvModule()).toBe(path);
	});

	test('a single-file project keeps it at the root', async () => {
		const path = await writeEnvModule(
			'env.ts',
			'export const env = defineEnv({ PORT: Type.Number({ default: 1 }) });'
		);

		expect(resolveEnvModule()).toBe(path);
	});

	test('no env module is not an error', () => {
		expect(resolveEnvModule()).toBeUndefined();
	});

	/* An explicit path comes back even when it does not exist, so the
	 * command can say that file is missing instead of quietly reading a
	 * different one. */
	test('an explicit path is taken as given', () => {
		expect(resolveEnvModule('config/env.ts')).toBe(
			join(directory, 'config/env.ts')
		);
	});
});

describe('reading what a project declares', () => {
	test('the type, the default and whether it is optional', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			`export const env = defineEnv({
				DATABASE_URL: Type.String({ format: 'uri' }),
				LOG_LEVEL: Type.Union([Type.Literal('debug'), Type.Literal('info')], { default: 'info' }),
				OPTIONAL_FLAG: Type.Optional(Type.Boolean()),
				PORT: Type.Number({ default: 3000 })
			});`
		);
		const read = await readEnvSchema(path);
		const byKey = new Map(
			(read.declarations ?? []).map((one) => [one.key, one])
		);

		expect([...byKey.keys()].sort()).toEqual([
			'DATABASE_URL',
			'LOG_LEVEL',
			'OPTIONAL_FLAG',
			'PORT'
		]);
		expect(byKey.get('DATABASE_URL')?.type).toBe('string (uri)');
		expect(byKey.get('LOG_LEVEL')?.type).toBe('"debug" | "info"');
		expect(byKey.get('PORT')?.default).toBe(3000);
		expect(byKey.get('OPTIONAL_FLAG')?.optional).toBe(true);
		expect(byKey.get('PORT')?.optional).toBe(false);
	});

	/* The reason inspection exists: reading the schema must not be stopped
	 * by the validation failure the command is there to report. */
	test('a module whose variables are all unset still reads', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			`export const env = defineEnv({ DATABASE_URL: Type.String({ format: 'uri' }) });`
		);
		const read = await readEnvSchema(path);

		expect(read.error).toBeUndefined();
		expect(read.declarations?.[0]?.key).toBe('DATABASE_URL');
	});

	/* And a module that reads a variable as it is imported — the normal
	 * shape, since the point of the file is to export the values. */
	test('a module that uses a value at import time still reads', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			`export const env = defineEnv({ PORT: Type.Number() });\nexport const doubled = env.PORT * 2;`
		);
		const read = await readEnvSchema(path);

		expect(read.error).toBeUndefined();
		expect(read.declarations?.[0]?.key).toBe('PORT');
	});

	/* A file that cannot be loaded is reported rather than swallowed: it
	 * is a different situation from declaring nothing, and a project whose
	 * env module is broken wants to be told. */
	test('a module that throws for its own reasons is reported', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			'throw new Error("boom");'
		);
		const read = await readEnvSchema(path);

		expect(read.error).toContain('boom');
		expect(read.declarations).toBeUndefined();
	});

	/* Inspection is scoped to the import. Leaving it on would turn a
	 * later `defineEnv` in the same process into a no-op that validates
	 * nothing. */
	test('inspection does not leak past the import', async () => {
		const path = await writeEnvModule(
			'src/env.ts',
			'export const env = defineEnv({ PORT: Type.Number({ default: 1 }) });'
		);
		await readEnvSchema(path);

		expect(process.env.ABSOLUTE_ENV_INSPECT).toBeUndefined();
	});
});
