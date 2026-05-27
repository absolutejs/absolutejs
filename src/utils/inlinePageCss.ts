/** Read the per-page compiled CSS sidecar that the build emitted next to
 *  the SSR JS, and splice it into the SSR head as an inline <style>
 *  block. Used by each framework's page handler so scoped/per-page
 *  styles are present on first paint instead of loading client-side
 *  after hydration (which produces a one-frame flash of unstyled
 *  chrome — sidebar/logo/cards).
 *
 *  The CSS sidecar is written by `core/build.ts` after the server and
 *  CSS Bun.build passes finish: for each SSR JS output, a `.css` file
 *  with the same basename + hash is placed beside it. The handler
 *  derives the sidecar path from the SSR JS path it already has
 *  (`pagePath` / `index`) so there's no manifest lookup, no extra
 *  argument the user must thread through, and no chance of getting
 *  the URL hash wrong.
 *
 *  Content-hashed filenames mean the sidecar is immutable for the
 *  lifetime of a build, so the read is memoised by absolute path and
 *  the handler hits `readFile` at most once per page per process. */
const siblingCssCache = new Map<string, string>();

export const injectInlineCss = <T extends string>(headTag: T, css: string) => {
	if (!css) return headTag;
	const styleBlock = `<style data-absolute-page-css>${css}</style>`;

	return headTag.replace('</head>', `${styleBlock}</head>`) as T;
};
export const readSiblingCss = async (siblingJsPath: string | undefined) => {
	if (!siblingJsPath) return '';
	const cssPath = siblingJsPath.replace(/\.js$/, '.css');
	if (cssPath === siblingJsPath) return '';
	const cached = siblingCssCache.get(cssPath);
	if (cached !== undefined) return cached;
	const { readFile } = await import('node:fs/promises');
	try {
		const css = await readFile(cssPath, 'utf-8');
		siblingCssCache.set(cssPath, css);

		return css;
	} catch {
		// No sidecar — page has no compiled styles, or dev-mode build
		// hasn't written one yet. Cache the miss so we don't repeatedly
		// stat a known-absent path.
		siblingCssCache.set(cssPath, '');

		return '';
	}
};
