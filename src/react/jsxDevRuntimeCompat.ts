import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

type JSXType = Parameters<typeof jsx>[0];
type JSXKey = Parameters<typeof jsx>[2];
type JSXProps = Record<string, unknown> | null | undefined;

export { Fragment };

export const jsxDEV = (
	type: JSXType,
	props: JSXProps,
	key?: JSXKey,
	_isStaticChildren?: boolean,
	_source?: unknown,
	_self?: unknown
) =>
	Array.isArray(props?.children)
		? jsxs(type, props as Parameters<typeof jsxs>[1], key)
		: jsx(type, props as Parameters<typeof jsx>[1], key);

export default {
	Fragment,
	jsxDEV
};
