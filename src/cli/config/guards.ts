export const getRecord = (value: unknown, key: string) => {
	if (!isRecord(value)) return null;
	const found = value[key];

	return isRecord(found) ? found : null;
};
export const getString = (value: unknown, key: string) => {
	if (!isRecord(value)) return null;
	const found = value[key];

	return typeof found === 'string' ? found : null;
};
export const isMap = (value: unknown): value is Map<unknown, unknown> =>
	value instanceof Map;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
