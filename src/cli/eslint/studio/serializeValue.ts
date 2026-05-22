const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const quoteString = (value: string) => `'${value.replace(/'/g, "\\'")}'`;

const serializeKey = (key: string) =>
	IDENTIFIER_PATTERN.test(key) ? key : quoteString(key);

/**
 * Emit a JS source literal for a rule option value in the same flat,
 * single-quoted style the config files already use (e.g.
 * `{ detectObjects: false, ignore: [0, 1, 2] }`). Used to render edited
 * rule values back into `eslint.config.*` so they read like hand-written
 * config rather than JSON.
 */
export const serializeRuleValue = (severity: string, options: unknown[]) => {
	if (options.length === 0) return quoteString(severity);
	const serializedOptions = options.map(serializeValue).join(', ');

	return `[${quoteString(severity)}, ${serializedOptions}]`;
};
export const serializeValue = (value: unknown): string => {
	if (typeof value === 'string') return quoteString(value);
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';

	if (Array.isArray(value)) {
		return `[${value.map(serializeValue).join(', ')}]`;
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value).map(
			([key, entryValue]) =>
				`${serializeKey(key)}: ${serializeValue(entryValue)}`
		);

		return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}';
	}

	return 'null';
};
