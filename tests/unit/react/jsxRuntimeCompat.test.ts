import { afterEach, describe, expect, test } from 'bun:test';
import { jsx, jsxs } from '../../../src/react/jsxRuntimeCompat';

const originalCapacitor = Reflect.get(globalThis, 'Capacitor');

const hydrationWarning = (element: unknown) => {
	if (typeof element !== 'object' || element === null) return undefined;
	const props: unknown = Reflect.get(element, 'props');
	if (typeof props !== 'object' || props === null) return undefined;

	return Reflect.get(props, 'suppressHydrationWarning');
};

afterEach(() => {
	if (originalCapacitor === undefined) {
		Reflect.deleteProperty(globalThis, 'Capacitor');
	} else {
		Reflect.set(globalThis, 'Capacitor', originalCapacitor);
	}
});

describe('React native JSX runtime compatibility', () => {
	test('marks only the native html root as hydration-safe', () => {
		Reflect.set(globalThis, 'Capacitor', { isNativePlatform: () => true });
		const root = jsxs('html', { children: [] });
		const body = jsx('body', {});

		expect(hydrationWarning(root)).toBe(true);
		expect(hydrationWarning(body)).toBeUndefined();
	});

	test('preserves normal web hydration diagnostics', () => {
		Reflect.set(globalThis, 'Capacitor', { isNativePlatform: () => false });
		const root = jsx('html', {});

		expect(hydrationWarning(root)).toBeUndefined();
	});
});
