import { describe, expect, test } from 'bun:test';
import { toPascal, toKebab, toScreamingSnake } from '../../../src/utils/stringModifiers';

describe('toPascal', () => {
	test('capitalizes single word', () => {
		expect(toPascal('hello')).toBe('Hello');
	});

	test('converts kebab-case', () => {
		expect(toPascal('my-component')).toBe('MyComponent');
	});

	test('converts snake_case', () => {
		expect(toPascal('my_component')).toBe('MyComponent');
	});

	test('handles already PascalCase', () => {
		expect(toPascal('MyComponent')).toBe('MyComponent');
	});

	test('handles mixed separators', () => {
		expect(toPascal('my-cool_component')).toBe('MyCoolComponent');
	});

	test('strips non-alphanumeric characters when separators present', () => {
		expect(toPascal('my@component-name!')).toBe('MycomponentName');
	});

	test('handles leading/trailing whitespace with separator', () => {
		expect(toPascal('  hello-world  ')).toBe('HelloWorld');
	});

	test('handles empty string', () => {
		expect(toPascal('')).toBe('');
	});

	test('handles single character', () => {
		expect(toPascal('a')).toBe('A');
	});

	test('handles multiple consecutive separators', () => {
		expect(toPascal('my--component')).toBe('MyComponent');
	});

	test('handles real framework page names', () => {
		expect(toPascal('ReactExample')).toBe('ReactExample');
		expect(toPascal('svelte-example')).toBe('SvelteExample');
		expect(toPascal('angular-example')).toBe('AngularExample');
		expect(toPascal('HTMLExample')).toBe('HTMLExample');
		expect(toPascal('vue-example')).toBe('VueExample');
	});
});

describe('toKebab', () => {
	test('converts camelCase', () => {
		expect(toKebab('myComponent')).toBe('my-component');
	});

	test('converts PascalCase', () => {
		expect(toKebab('MyComponent')).toBe('my-component');
	});

	test('handles already kebab-case', () => {
		expect(toKebab('my-component')).toBe('my-component');
	});
});

describe('toScreamingSnake', () => {
	test('converts camelCase', () => {
		expect(toScreamingSnake('myVariable')).toBe('MY_VARIABLE');
	});

	test('converts PascalCase', () => {
		expect(toScreamingSnake('MyComponent')).toBe('MY_COMPONENT');
	});
});
