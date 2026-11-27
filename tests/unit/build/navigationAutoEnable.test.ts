import { afterEach, describe, expect, test } from 'bun:test';
import {
	navigationAutoEnabled,
	setNavigationAutoEnable,
	withNavigationAutoEnable
} from '../../../src/build/navigationAutoEnable';

/* `config.navigation`, as it reaches a page's client entry: the call
 * appended to the entry, and what it is called with. */

const SOURCE = 'const page = 1;';

afterEach(() => {
	// Process-wide, like the config it mirrors.
	setNavigationAutoEnable(false);
});

describe('config.navigation in a hydration index', () => {
	test('off, the entry is left as it is', () => {
		setNavigationAutoEnable(false);

		expect(navigationAutoEnabled()).toBe(false);
		expect(withNavigationAutoEnable(SOURCE)).toBe(SOURCE);
	});

	test('left out is off', () => {
		setNavigationAutoEnable(undefined);

		expect(withNavigationAutoEnable(SOURCE)).toBe(SOURCE);
	});

	test('`true` calls enableNavigation() with nothing', () => {
		setNavigationAutoEnable(true);

		const source = withNavigationAutoEnable(SOURCE);
		expect(source.startsWith(SOURCE)).toBe(true);
		expect(source).toContain('__absoluteEnableNavigation__();');
	});

	test('an object turns the layer on and is what the call is given', () => {
		setNavigationAutoEnable({ inPlace: false });

		expect(navigationAutoEnabled()).toBe(true);
		expect(withNavigationAutoEnable(SOURCE)).toContain(
			'__absoluteEnableNavigation__({"inPlace":false});'
		);
	});

	test('an empty object is on, with the defaults', () => {
		setNavigationAutoEnable({});

		expect(withNavigationAutoEnable(SOURCE)).toContain(
			'__absoluteEnableNavigation__({});'
		);
	});
});
