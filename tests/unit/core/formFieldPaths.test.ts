import { describe, expect, test } from 'bun:test';
import { t } from 'elysia';
import {
	formatFieldPath,
	instancePathToField,
	isNestedFieldName,
	parseFieldName,
	schemaAtPath,
	setAtPath
} from '../../../src/core/formFieldPaths';

const order = t.Object({
	address: t.Object({ city: t.String(), zip: t.String() }),
	items: t.Array(t.Object({ qty: t.Number(), sku: t.String() })),
	tags: t.Optional(t.Array(t.String())),
	title: t.String()
});

describe('parseFieldName', () => {
	test('reads both notations the same way', () => {
		expect(parseFieldName('items[0].sku')).toEqual(['items', '0', 'sku']);
		expect(parseFieldName('items.0.sku')).toEqual(['items', '0', 'sku']);
		expect(parseFieldName('address.city')).toEqual(['address', 'city']);
		expect(parseFieldName('title')).toEqual(['title']);
		expect(parseFieldName('grid[0][1]')).toEqual(['grid', '0', '1']);
	});
});

describe('formatFieldPath', () => {
	test('writes indices in brackets and keys after dots', () => {
		expect(formatFieldPath(['items', '0', 'sku'])).toBe('items[0].sku');
		expect(formatFieldPath(['address', 'city'])).toBe('address.city');
		expect(formatFieldPath(['title'])).toBe('title');
	});

	test('a validator path becomes the name the form used', () => {
		// So the error lands on the input, which is what makes a nested
		// form show its errors in the right place.
		expect(instancePathToField('/items/0/sku')).toBe('items[0].sku');
		expect(instancePathToField('/address/city')).toBe('address.city');
		expect(instancePathToField('/title')).toBe('title');
		expect(instancePathToField('')).toBe('');
	});
});

describe('isNestedFieldName', () => {
	test('is true only for a name that describes a path', () => {
		expect(isNestedFieldName('address.city')).toBe(true);
		expect(isNestedFieldName('items[0]')).toBe(true);
		expect(isNestedFieldName('title')).toBe(false);
	});
});

describe('schemaAtPath', () => {
	test('walks objects, arrays and optional wrappers', () => {
		expect(schemaAtPath(order, ['address', 'city'])).toBeDefined();
		expect(schemaAtPath(order, ['items', '0', 'sku'])).toBeDefined();
		expect(schemaAtPath(order, ['tags', '0'])).toBeDefined();
	});

	test('a path the schema does not declare resolves to nothing', () => {
		// Which is what leaves such a name alone, to fail validation as an
		// unknown field rather than creating something.
		expect(schemaAtPath(order, ['address', 'country'])).toBeUndefined();
		expect(schemaAtPath(order, ['title', 'city'])).toBeUndefined();
		// An array stepped into by anything but an index.
		expect(schemaAtPath(order, ['items', 'sku'])).toBeUndefined();
	});

	test('never walks a path through __proto__ or constructor', () => {
		expect(schemaAtPath(order, ['__proto__', 'polluted'])).toBeUndefined();
		expect(
			schemaAtPath(order, ['constructor', 'prototype', 'x'])
		).toBeUndefined();
	});
});

describe('setAtPath', () => {
	test('creates the objects and arrays on the way', () => {
		const body: Record<string, unknown> = {};
		setAtPath(body, ['address', 'city'], 'Paris');
		setAtPath(body, ['items', '0', 'sku'], 'abc');
		expect(body).toEqual({
			address: { city: 'Paris' },
			items: [{ sku: 'abc' }]
		});
	});

	test('names sharing a prefix land in one object', () => {
		const body: Record<string, unknown> = {};
		setAtPath(body, ['items', '0', 'sku'], 'abc');
		setAtPath(body, ['items', '0', 'qty'], '2');
		setAtPath(body, ['items', '1', 'sku'], 'xyz');
		expect(body).toEqual({
			items: [{ qty: '2', sku: 'abc' }, { sku: 'xyz' }]
		});
	});

	test('refuses a path through __proto__, whatever the schema said', () => {
		const body: Record<string, unknown> = {};
		setAtPath(body, ['__proto__', 'polluted'], 'yes');
		setAtPath(body, ['constructor', 'prototype', 'polluted'], 'yes');
		expect(body).toEqual({});
		expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined();
		expect(Reflect.get({}, 'polluted')).toBeUndefined();
	});
});
