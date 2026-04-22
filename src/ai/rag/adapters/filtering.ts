const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const valuesMatch = (expected: unknown, actual: unknown) => {
	if (actual === expected) {
		return true;
	}

	if (
		typeof actual === 'object' &&
		actual !== null &&
		typeof expected === 'object' &&
		expected !== null
	) {
		return JSON.stringify(actual) === JSON.stringify(expected);
	}

	return false;
};

const isFilterOperatorRecord = (
	value: unknown
): value is Record<string, unknown> =>
	isObjectRecord(value) &&
	Object.keys(value).some((key) => key.startsWith('$'));

const getPathValue = (
	record: Record<string, unknown>,
	path: string
): unknown => {
	const segments = path.split('.').filter(Boolean);
	let current: unknown = record;

	for (const segment of segments) {
		if (!isObjectRecord(current)) {
			return undefined;
		}

		current = current[segment];
	}

	return current;
};

const matchesRangeValue = (
	actual: unknown,
	expected: unknown,
	comparison: (actual: number, expected: number) => boolean
) =>
	typeof actual === 'number' &&
	Number.isFinite(actual) &&
	typeof expected === 'number' &&
	Number.isFinite(expected) &&
	comparison(actual, expected);

const arrayContainsValue = (actual: unknown, expected: unknown): boolean =>
	Array.isArray(actual) &&
	actual.some((entry) => matchesMetadataFilterValue(entry, expected));

const matchesOperatorFilter = (
	actual: unknown,
	filter: Record<string, unknown>
): boolean =>
	Object.entries(filter).every(([operator, expected]) => {
		switch (operator) {
			case '$exists':
				return Boolean(expected)
					? actual !== undefined
					: actual === undefined;
			case '$in':
				return Array.isArray(expected)
					? expected.some((candidate) =>
							valuesMatch(candidate, actual)
						)
					: false;
			case '$contains':
				return arrayContainsValue(actual, expected);
			case '$containsAny':
				return Array.isArray(expected)
					? expected.some((candidate) =>
							arrayContainsValue(actual, candidate)
						)
					: false;
			case '$containsAll':
				return Array.isArray(expected)
					? expected.every((candidate) =>
							arrayContainsValue(actual, candidate)
						)
					: false;
			case '$ne':
				return !valuesMatch(expected, actual);
			case '$gt':
				return matchesRangeValue(
					actual,
					expected,
					(left, right) => left > right
				);
			case '$gte':
				return matchesRangeValue(
					actual,
					expected,
					(left, right) => left >= right
				);
			case '$lt':
				return matchesRangeValue(
					actual,
					expected,
					(left, right) => left < right
				);
			case '$lte':
				return matchesRangeValue(
					actual,
					expected,
					(left, right) => left <= right
				);
			default:
				return false;
		}
	});

export const matchesMetadataFilterValue = (
	actual: unknown,
	expected: unknown
): boolean =>
	isFilterOperatorRecord(expected)
		? matchesOperatorFilter(actual, expected)
		: Array.isArray(actual)
			? actual.some((entry) => valuesMatch(expected, entry))
			: valuesMatch(expected, actual);

const isNestedFilterArray = (
	value: unknown
): value is Record<string, unknown>[] =>
	Array.isArray(value) && value.every((entry) => isObjectRecord(entry));

const matchesLogicalFilter = (
	record: Record<string, unknown>,
	key: string,
	value: unknown
): boolean => {
	switch (key) {
		case '$and':
			return isNestedFilterArray(value)
				? value.every((entry) =>
						matchesMetadataFilterRecord(record, entry)
					)
				: false;
		case '$or':
			return isNestedFilterArray(value)
				? value.some((entry) =>
						matchesMetadataFilterRecord(record, entry)
					)
				: false;
		case '$not':
			return isObjectRecord(value)
				? !matchesMetadataFilterRecord(record, value)
				: false;
		default:
			return false;
	}
};

export const matchesMetadataFilterRecord = (
	record: Record<string, unknown>,
	filter?: Record<string, unknown>
) => {
	if (!filter) {
		return true;
	}

	return Object.entries(filter).every(([key, value]) => {
		if (key.startsWith('$')) {
			return matchesLogicalFilter(record, key, value);
		}

		return matchesMetadataFilterValue(getPathValue(record, key), value);
	});
};
