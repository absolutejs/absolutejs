import {
	Fragment,
	jsx as reactJsx,
	jsxs as reactJsxs
} from 'react/jsx-runtime';

type JSXType = Parameters<typeof reactJsx>[0];
type JSXProps = Parameters<typeof reactJsx>[1];
type JSXKey = Parameters<typeof reactJsx>[2];

const nativeRootProps = (type: JSXType, props: JSXProps) => {
	if (type !== 'html') return props;
	const capacitor: unknown = Reflect.get(globalThis, 'Capacitor');
	if (typeof capacitor !== 'object' || capacitor === null) return props;
	const isNativePlatform: unknown = Reflect.get(
		capacitor,
		'isNativePlatform'
	);
	if (
		typeof isNativePlatform !== 'function' ||
		isNativePlatform.call(capacitor) !== true
	) {
		return props;
	}

	// Capacitor's SystemBars plugin owns safe-area CSS variables on <html>.
	// React must preserve those native runtime attributes during hydration.
	return Object.assign(
		{},
		typeof props === 'object' && props !== null ? props : {},
		{ suppressHydrationWarning: true }
	);
};

export { Fragment };

export const jsx = (type: JSXType, props: JSXProps, key?: JSXKey) =>
	reactJsx(type, nativeRootProps(type, props), key);

export const jsxs = (type: JSXType, props: JSXProps, key?: JSXKey) =>
	reactJsxs(type, nativeRootProps(type, props), key);
