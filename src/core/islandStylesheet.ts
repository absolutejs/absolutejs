import type { IslandFramework } from '../../types/island';
import { readCspNonce } from '../utils/cspNonceRef';
import { getIslandStyleManifestKey } from './islandManifest';

/* An island's built stylesheet, looked up where the host-side Island
 * components can see it: on the server the build manifest prepare()
 * recorded, in the browser the one the server injected into the page.
 * Shared by server and browser code, so nothing here imports server-only
 * modules. */

/** Vue SSR context key under which a streamed Vue page render collects the
 *  stylesheets its Islands have linked inline (see vue/islandStyleLink.ts). */
export const INLINE_ISLAND_STYLES_CONTEXT_KEY = '__absoluteInlineIslandStyles';

/** React 19 stylesheet precedence for island stylesheets: React hoists
 *  `<link rel="stylesheet" precedence>` into the head and renders each href
 *  once, however many islands ask for it. */
export const ISLAND_STYLE_PRECEDENCE = 'absolute-islands';

const ISLAND_FRAMEWORKS: readonly IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular'
];

const toIslandFramework = (value: string) =>
	ISLAND_FRAMEWORKS.find((framework) => framework === value);

const readIslandManifest = () => {
	const manifest: unknown =
		typeof window === 'undefined'
			? Reflect.get(globalThis, '__absoluteManifest')
			: Reflect.get(window, '__ABSOLUTE_MANIFEST__');

	return typeof manifest === 'object' && manifest !== null
		? manifest
		: undefined;
};

/** The stylesheet the build emitted for an island, if it has one. */
export const findIslandStylesheet = (framework: string, component: string) => {
	const islandFramework = toIslandFramework(framework);
	const manifest = readIslandManifest();
	if (!islandFramework || !manifest) return undefined;

	const key = getIslandStyleManifestKey(islandFramework, component);
	const href: unknown = Reflect.get(manifest, key);

	return typeof href === 'string' ? { href, key } : undefined;
};

/** The page's CSP nonce, for a stylesheet link a policy without 'self'
 *  would otherwise refuse. On the server, the request's; in the browser,
 *  read from a tag the server nonced (`.nonce`: browsers hide the
 *  attribute once applied). '' when there is none. */
export const readIslandStyleNonce = () => {
	if (typeof document === 'undefined') return readCspNonce() ?? '';

	return (
		Array.from(
			document.querySelectorAll<HTMLElement>('script[nonce]')
		).find((element) => element.nonce)?.nonce ?? ''
	);
};
