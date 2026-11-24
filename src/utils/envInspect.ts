/* How a tool reads a project's env schema without being stopped by the
 * very thing it is reporting on.
 *
 * `defineEnv` validates when the module containing it is imported, and
 * throws when a variable is missing — which is right for a server and
 * impossible for `absolute env`, whose entire job is to say WHICH
 * variables are missing. Importing the project's env module to read its
 * schema would throw before printing anything.
 *
 * So the CLI sets `ABSOLUTE_ENV_INSPECT` before the import. In that mode
 * `defineEnv` records its properties here and returns a schema-shaped
 * placeholder instead of validating, so a module that reads a variable at
 * import time still evaluates. Nothing else changes, and no project code
 * has to know: the alternative was asking a project to export its schema
 * separately from the call that consumes it, which nobody would keep in
 * step. */

import type { TProperties, TSchema } from '@sinclair/typebox';
import { ENV_FORMAT_SAMPLES } from './envFormats';

const SCHEMAS_KEY = Symbol.for('absolutejs.envSchemas');

/** The variable the CLI sets around the import. Named rather than
 *  inlined because two modules have to agree on it. */
export const ENV_INSPECT_VARIABLE = 'ABSOLUTE_ENV_INSPECT';

const schemaList = () => {
	const existing: unknown = Reflect.get(globalThis, SCHEMAS_KEY);
	const list: TProperties[] = Array.isArray(existing) ? existing : [];
	if (!Array.isArray(existing)) Reflect.set(globalThis, SCHEMAS_KEY, list);

	return list;
};

/** Forgets what earlier inspections recorded, so a read reports what ITS
 *  import declared and not the accumulation of every one before it.
 *  Caught by a test whose module declared `PORT` and was handed the
 *  `DATABASE_URL` of the test before it. */
export const clearInspectedEnvSchemas = () => {
	schemaList().length = 0;
};

/** Every schema `defineEnv` saw during an inspection import. A project
 *  may call `defineEnv` more than once — a server module and a worker,
 *  say — and all of them are a tool's business. */
export const inspectedEnvSchemas = () => [...schemaList()];

const placeholderFor = (schema: TSchema): unknown => {
	const given: unknown = Reflect.get(schema, 'default');
	if (given !== undefined) return given;
	const literal: unknown = Reflect.get(schema, 'const');
	if (literal !== undefined) return literal;
	const union: unknown = Reflect.get(schema, 'anyOf');
	if (Array.isArray(union) && union.length > 0)
		return placeholderFor(union[0]);
	const format: unknown = Reflect.get(schema, 'format');
	if (typeof format === 'string') return ENV_FORMAT_SAMPLES[format] ?? 'x';
	const type: unknown = Reflect.get(schema, 'type');
	if (type === 'number' || type === 'integer') return 0;
	if (type === 'boolean') return false;
	if (type === 'array') return [];

	return '';
};

/** A value for every declared variable that satisfies its own schema, so
 *  an inspection import can hand back something of the right shape rather
 *  than throwing on the first variable that is not set. */
export const envPlaceholders = (properties: TProperties) =>
	Object.fromEntries(
		Object.entries(properties).map(([key, schema]) => [
			key,
			placeholderFor(schema)
		])
	);

/** Whether `defineEnv` should record rather than validate. */
export const isInspectingEnv = () =>
	process.env[ENV_INSPECT_VARIABLE] !== undefined;

export const recordEnvSchema = (properties: TProperties) => {
	schemaList().push(properties);
};
