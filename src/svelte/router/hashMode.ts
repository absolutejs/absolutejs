/**
 * Hash mode: routing happens against `window.location.hash` with the
 * leading `#/` stripped. Useful for static deploys (GitHub Pages, S3)
 * where the host can't be configured to wildcard-route to one HTML file.
 *
 * URLs look like `https://example.com/#/dashboard/settings`. The
 * `pathname` part stays at `/` so the server always serves the same
 * page; `<Route>` matching looks at the hash instead.
 */

/**
 * Extract the routable pathname from a full URL when hash mode is on.
 * Returns the part after `#/`, prefixed with `/` so it parses as a
 * normal pathname.
 */
export const buildHashHref = (pathname: string) => {
	const trimmed = pathname.replace(/^\/+/, '');

	return trimmed === '' ? '#/' : `#/${trimmed}`;
};
export const hashPathnameOf = (url: URL) => {
	const { hash } = url;
	if (!hash || hash === '#') return '/';

	// Tolerate both `#/foo` and `#foo`.
	const trimmed = hash.startsWith('#/') ? hash.slice(2) : hash.slice(1);

	if (trimmed === '') return '/';

	return `/${trimmed.replace(/^\/+/, '')}`;
};
