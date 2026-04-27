import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

type JSXType = Parameters<typeof jsx>[0];
type JSXKey = Parameters<typeof jsx>[2];
type JSXProps = Parameters<typeof jsx>[1] & {
	children?: unknown;
};

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
		? jsxs(type, props, key)
		: jsx(type, props, key);
