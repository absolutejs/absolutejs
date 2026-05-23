import { isRecord } from '../guards';

const isIdentifier = (key: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

// Serialize a JSON-compatible value to a TypeScript object-literal string in the
// house style (single-quoted strings, unquoted identifier keys, tab indent).
// Only used for fully-literal config values, so there are no refs to preserve.
export const serializeValue = (
	value: unknown,
	level = 1,
	indent = '\t'
): string => {
	if (value === null) return 'null';
	if (typeof value === 'string') {
		return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		const pad = indent.repeat(level + 1);

		return `[\n${value
			.map((item) => `${pad}${serializeValue(item, level + 1, indent)}`)
			.join(',\n')}\n${indent.repeat(level)}]`;
	}
	if (isRecord(value)) {
		const keys = Object.keys(value);
		if (keys.length === 0) return '{}';
		const pad = indent.repeat(level + 1);

		return `{\n${keys
			.map((key) => {
				const name = isIdentifier(key) ? key : `'${key}'`;

				return `${pad}${name}: ${serializeValue(value[key], level + 1, indent)}`;
			})
			.join(',\n')}\n${indent.repeat(level)}}`;
	}

	return 'undefined';
};
