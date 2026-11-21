/* The URL prefix the page is served under (set by the page's head when the
 * server has a base path; see src/utils/basePath.ts), for client code that
 * builds URLs itself. */
export const clientBasePath = () =>
	typeof window === 'undefined' ? '' : (window.__ABSOLUTE_BASE_PATH__ ?? '');

/** A root-absolute URL under the page's base. */
export const withClientBasePath = (path: string) => {
	const base = clientBasePath();
	if (base === '' || !path.startsWith('/') || path.startsWith('//'))
		return path;
	if (path === base || path.startsWith(`${base}/`)) return path;

	return `${base}${path}`;
};

/** A pathname with the page's base taken off: `/base/@src/x` -> `/@src/x`. */
export const withoutClientBasePath = (pathname: string) => {
	const base = clientBasePath();

	return base !== '' && pathname.startsWith(`${base}/`)
		? pathname.slice(base.length)
		: pathname;
};
