const BOOTSTRAP_MANIFEST_KEY = 'BootstrapClient';
const ISLAND_MARKER = 'data-island="true"';
const MANIFEST_MARKER = '__ABSOLUTE_MANIFEST__';
const ISLAND_STATE_MARKER = '__ABS_ISLAND_STATE__';

declare global {
	var __absoluteManifest: Record<string, string> | undefined;
	var __ABS_ISLAND_STATE__:
		| Record<string, Record<string, unknown>>
		| undefined;
}

const buildIslandsHeadMarkup = (manifest: Record<string, string>) => {
	const manifestScript = `<script>window.__ABSOLUTE_MANIFEST__ = ${JSON.stringify(manifest)}</script>`;
	const islandStateScript = `<script>window.__ABS_ISLAND_STATE__ = ${JSON.stringify(globalThis.__ABS_ISLAND_STATE__ ?? {})}</script>`;
	const bootstrapPath = manifest[BOOTSTRAP_MANIFEST_KEY];
	const bootstrapScript = bootstrapPath
		? `<script type="module" src="${bootstrapPath}"></script>`
		: '';

	return `${manifestScript}${islandStateScript}${bootstrapScript}`;
};

const injectHeadMarkup = (html: string, markup: string) => {
	const closingHeadIndex = html.indexOf('</head>');
	if (closingHeadIndex >= 0) {
		return `${html.slice(0, closingHeadIndex)}${markup}${html.slice(closingHeadIndex)}`;
	}

	const openingBodyIndex = html.indexOf('<body');
	if (openingBodyIndex >= 0) {
		const bodyStart = html.indexOf('>', openingBodyIndex);
		if (bodyStart >= 0) {
			return `${html.slice(0, openingBodyIndex)}<head>${markup}</head>${html.slice(openingBodyIndex)}`;
		}
	}

	return `<!DOCTYPE html><html><head>${markup}</head><body>${html}</body></html>`;
};

export const htmlContainsIslands = (html: string) =>
	html.includes(ISLAND_MARKER);
export const injectIslandPageContext = (
	html: string,
	options?: { hasIslands?: boolean }
) => {
	const manifest = globalThis.__absoluteManifest;
	const hasIslands = options?.hasIslands ?? htmlContainsIslands(html);
	if (!manifest || !hasIslands) {
		return html;
	}

	if (html.includes(MANIFEST_MARKER) || html.includes(ISLAND_STATE_MARKER)) {
		return html;
	}

	return injectHeadMarkup(html, buildIslandsHeadMarkup(manifest));
};
export const setCurrentIslandManifest = (manifest: Record<string, string>) => {
	globalThis.__absoluteManifest = manifest;
};
