/* Field names that describe a place in a nested body.
 *
 * A form has one flat list of name/value pairs, so a nested body has to be
 * spelled into the names: `address.city`, `items[0].sku`. Both notations
 * are read, and a path is written back in the one most form authors use —
 * dots between keys, brackets around indices — so an error reported for
 * `/items/0/sku` lands on the input named `items[0].sku`.
 *
 * Expansion is driven by the schema, never by the submitted names alone.
 * A name that does not describe a path the schema declares is left exactly
 * as it arrived, so it fails validation as an unknown field rather than
 * creating something. That is also what keeps `__proto__.polluted=1` from
 * meaning anything: there is no such property in the schema to walk. */

import type { TObject } from 'typebox';

const SEGMENT = /[^.[\]]+/g;
const INDEX = /^\d+$/;

/* Never walked, whatever a schema happens to declare. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** `['items', '0', 'sku']` becomes `items[0].sku`. */
export const formatFieldPath = (segments: readonly string[]) =>
	segments.reduce((path, segment, index) => {
		if (index === 0) return segment;
		if (INDEX.test(segment)) return `${path}[${segment}]`;

		return `${path}.${segment}`;
	}, '');

/** A validator's `/items/0/sku` as the field name a form would use. */
export const instancePathToField = (instancePath: string) =>
	formatFieldPath(instancePath.replace(/^\//, '').split('/').filter(Boolean));

/** Whether a name describes anywhere but the top level. */
export const isNestedFieldName = (name: string) => /[.[]/.test(name);

/** `items[0].sku` and `items.0.sku` both become `['items', '0', 'sku']`. */
export const parseFieldName = (name: string) => name.match(SEGMENT) ?? [];

const unwrapUnion = (schema: unknown) => {
	if (!isRecord(schema) || !Array.isArray(schema.anyOf)) return [schema];

	return schema.anyOf;
};

/* The schema for one step: a property of an object, or an array's items
 * for an index. Optional wrappers arrive as unions, so try each member. */
const stepInto = (schema: unknown, segment: string) => {
	if (FORBIDDEN.has(segment)) return undefined;
	for (const member of unwrapUnion(schema)) {
		if (!isRecord(member)) continue;
		const { items, properties, type } = member;
		if (type === 'array' && INDEX.test(segment)) return items;
		if (isRecord(properties) && segment in properties)
			return properties[segment];
	}

	return undefined;
};

/** The schema at `segments`, or undefined when the path is not one this
 *  schema declares — including a path through an array that is not an
 *  index, or any step named `__proto__`. */
export const schemaAtPath = (schema: TObject, segments: readonly string[]) =>
	segments.reduce<unknown>(
		(current, segment) =>
			current === undefined ? undefined : stepInto(current, segment),
		schema
	);

const containerFor = (segment: string) => (INDEX.test(segment) ? [] : {});

const childOf = (parent: unknown, segment: string, next: string) => {
	if (!isRecord(parent) && !Array.isArray(parent)) return undefined;
	const existing: unknown = Reflect.get(parent, segment);
	if (isRecord(existing) || Array.isArray(existing)) return existing;
	const created = containerFor(next);
	Reflect.set(parent, segment, created);

	return created;
};

/** Writes `value` at `segments`, creating the objects and arrays on the
 *  way. Anything already there is reused, so two names that share a prefix
 *  (`items[0].sku`, `items[0].qty`) land in one object. */
export const setAtPath = (
	target: Record<string, unknown>,
	segments: readonly string[],
	value: unknown
) => {
	const last = segments[segments.length - 1];
	if (last === undefined || segments.some((name) => FORBIDDEN.has(name)))
		return;
	const parent = segments
		.slice(0, -1)
		.reduce<unknown>(
			(current, segment, index) =>
				childOf(current, segment, segments[index + 1] ?? ''),
			target
		);
	if (isRecord(parent) || Array.isArray(parent))
		Reflect.set(parent, last, value);
};
