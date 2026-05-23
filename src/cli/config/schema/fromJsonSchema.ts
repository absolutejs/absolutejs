import { isRecord } from '../guards';
import type { FieldNode, FieldSchema } from '../../../../types/config';

const MAX_DEPTH = 6;

const opaque = (): FieldSchema => ({ kind: 'opaque', typeText: 'json' });

// Map a JSON Schema node to our normalized FieldSchema so the recursive
// FieldEditor can render it (used for ESLint rule options, which ship a schema).
export const fromJsonSchema = (schema: unknown, depth = 0): FieldSchema => {
	if (depth > MAX_DEPTH || !isRecord(schema)) return opaque();

	if (Array.isArray(schema.enum)) {
		const choices = schema.enum.filter(
			(value): value is string | number =>
				typeof value === 'string' || typeof value === 'number'
		);
		if (choices.length > 0) return { choices, kind: 'enum' };
	}

	const variants = schema.oneOf ?? schema.anyOf;
	if (Array.isArray(variants) && variants.length > 0) {
		return {
			kind: 'union',
			variants: variants.map((variant) =>
				fromJsonSchema(variant, depth + 1)
			)
		};
	}

	const declared = schema.type;
	const type = Array.isArray(declared)
		? declared.find((entry) => entry !== 'null')
		: declared;

	if (type === 'string') return { kind: 'string' };
	if (type === 'number' || type === 'integer') return { kind: 'number' };
	if (type === 'boolean') return { kind: 'boolean' };

	if (type === 'array') {
		const items = schema.items;
		if (Array.isArray(items)) {
			return {
				items: items.map((item) => fromJsonSchema(item, depth + 1)),
				kind: 'tuple'
			};
		}

		return {
			item: items ? fromJsonSchema(items, depth + 1) : opaque(),
			kind: 'array'
		};
	}

	if (type === 'object' || isRecord(schema.properties)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		const fields: FieldNode[] = Object.entries(properties).map(
			([name, sub]) => ({
				description:
					isRecord(sub) && typeof sub.description === 'string'
						? sub.description
						: '',
				name,
				optional: !required.includes(name),
				schema: fromJsonSchema(sub, depth + 1)
			})
		);
		if (fields.length > 0) return { fields, kind: 'object' };

		const additional = schema.additionalProperties;
		if (isRecord(additional)) {
			return {
				kind: 'record',
				value: fromJsonSchema(additional, depth + 1)
			};
		}
		if (additional !== false) {
			return { kind: 'record', value: opaque() };
		}

		return { fields: [], kind: 'object' };
	}

	return opaque();
};

// An ESLint rule's `meta.schema` describes its *options array*. Normalize it to
// a single FieldSchema for that array (positional schemas become a tuple).
export const eslintOptionsSchema = (metaSchema: unknown): FieldSchema => {
	if (Array.isArray(metaSchema)) {
		if (metaSchema.length === 0)
			return { kind: 'opaque', typeText: 'options' };

		return {
			items: metaSchema.map((entry) => fromJsonSchema(entry)),
			kind: 'tuple'
		};
	}
	if (isRecord(metaSchema)) {
		if (metaSchema.type === 'array') return fromJsonSchema(metaSchema);

		return { items: [fromJsonSchema(metaSchema)], kind: 'tuple' };
	}

	return { kind: 'opaque', typeText: 'options' };
};
