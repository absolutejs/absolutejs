/* Reading what a project's env schema declares, for `absolute env`.
 *
 * The command used to know about one thing: a regex for `getEnv('X')`.
 * A project that declares its environment with `defineEnv` — the typed
 * path, with defaults, coercion and validation — got
 * `No getEnv() usage found under src/.` So the command said nothing at
 * all precisely for the projects doing it the recommended way, which is
 * worse than saying nothing for everyone.
 *
 * Importing the project's module is what makes the difference between
 * listing the variables it USES and the variables it DECLARES: a schema
 * carries the type, the default and whether it is optional, none of which
 * a call site shows. The import happens under `ABSOLUTE_ENV_INSPECT` so
 * `defineEnv` records instead of validating — see utils/envInspect.ts. */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	OptionalKind,
	type TProperties,
	type TSchema
} from '@sinclair/typebox';
import {
	clearInspectedEnvSchemas,
	ENV_INSPECT_VARIABLE,
	inspectedEnvSchemas
} from '../../utils/envInspect';

/* Where a project keeps it. `src/env.ts` first because that is the layout
 * the rest of the CLI assumes, then the root for a single-file project. */
const CONVENTIONAL_PATHS = [
	'src/env.ts',
	'src/env/index.ts',
	'env.ts',
	'src/env.tsx',
	'src/env.js',
	'env.js'
];

export type EnvDeclaration = {
	default: unknown;
	key: string;
	optional: boolean;
	/* Kept so the caller can check a real value against it: presence is
	 * the easy half, and a PORT of "notanumber" is the half a startup
	 * check is for. */
	schema: TSchema;
	type: string;
};

/** A human-readable type for one property, which is what a reader of the
 *  table actually wants: `number`, `"debug" | "info"`, `string`. */
/* Takes `unknown` rather than `TSchema` so a union member can be read
 * without an assertion: the members of `anyOf` are plain values as far as
 * the type system is concerned. */
const describeType = (schema: unknown): string => {
	if (typeof schema !== 'object' || schema === null) return 'unknown';
	const union: unknown = Reflect.get(schema, 'anyOf');
	if (Array.isArray(union))
		return union.map((member: unknown) => describeType(member)).join(' | ');
	const literal: unknown = Reflect.get(schema, 'const');
	if (literal !== undefined) return JSON.stringify(literal);
	const format: unknown = Reflect.get(schema, 'format');
	const type: unknown = Reflect.get(schema, 'type');
	const name = typeof type === 'string' ? type : 'unknown';

	return typeof format === 'string' ? `${name} (${format})` : name;
};

/** The file to read, or `undefined` when the project has no env module.
 *  An explicit path is returned even when it does not exist, so the
 *  command can say the given file is missing rather than silently falling
 *  back to a convention. */
export const resolveEnvModule = (explicit?: string) => {
	if (explicit !== undefined) return resolve(process.cwd(), explicit);
	const found = CONVENTIONAL_PATHS.map((path) =>
		resolve(process.cwd(), path)
	).find((path) => existsSync(path));

	return found;
};

const declarationsOf = (properties: TProperties) =>
	Object.entries(properties).map(([key, schema]) => ({
		default: Reflect.get(schema, 'default'),
		key,
		/* TypeBox marks optionality with its own symbol, not by accepting
		 * `undefined`: `Value.Check(Type.Optional(Type.Boolean()),
		 * undefined)` is false, so testing the value reported every
		 * optional variable as required. */
		optional: Reflect.get(schema, OptionalKind) === 'Optional',
		schema,
		type: describeType(schema)
	}));

/** Imports the module with inspection on and returns what it declared.
 *  A module that throws for its own reasons is reported rather than
 *  swallowed: a project whose env file cannot be loaded wants to know
 *  that, and the distinction from "declares nothing" matters. */
export const readEnvSchema = async (path: string) => {
	const previous = process.env[ENV_INSPECT_VARIABLE];
	process.env[ENV_INSPECT_VARIABLE] = '1';
	/* Only what this import declares. A module already in the import cache
	 * records nothing the second time, so a caller reading the same file
	 * twice in one process sees it once — which is the honest answer for a
	 * command that runs once per process. */
	clearInspectedEnvSchemas();
	try {
		await import(path);

		return { declarations: inspectedEnvSchemas().flatMap(declarationsOf) };
	} catch (cause) {
		return {
			error: cause instanceof Error ? cause.message : String(cause)
		};
	} finally {
		if (previous === undefined) delete process.env[ENV_INSPECT_VARIABLE];
		else process.env[ENV_INSPECT_VARIABLE] = previous;
	}
};
