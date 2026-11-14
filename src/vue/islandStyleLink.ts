import { h, type VNode } from 'vue';
import type { RuntimeIslandRenderProps } from '../../types/island';
import { claimServerIslandStyleLink } from '../client/preserveIslandMarkup';
import {
	findIslandStylesheet,
	INLINE_ISLAND_STYLES_CONTEXT_KEY,
	readIslandStyleNonce
} from '../core/islandStylesheet';

/* Island stylesheets on Vue host pages.
 *
 * A Vue page rendered whole gets them in its head, like any document (see
 * core/islandPageContext.ts). A streamed one (streaming slots) writes its
 * head before the body exists, so the page handler puts a Set on the SSR
 * context (INLINE_ISLAND_STYLES_CONTEXT_KEY), and each Island renders its
 * stylesheet link right before the island, once per stylesheet per render.
 * Hydration reads that link back from the DOM. */

type IslandStyleProps = Pick<
	RuntimeIslandRenderProps,
	'component' | 'framework'
>;

const readInlineStyleKeys = (ssrContext: unknown) => {
	if (typeof ssrContext !== 'object' || ssrContext === null) return undefined;
	const keys: unknown = Reflect.get(
		ssrContext,
		INLINE_ISLAND_STYLES_CONTEXT_KEY
	);

	return keys instanceof Set ? keys : undefined;
};

/** Server: the props of the island's link for a streamed render, the first time this
 *  render asks for that stylesheet; otherwise null. */
export const claimInlineIslandStyleLink = (
	ssrContext: unknown,
	props: IslandStyleProps
) => {
	const claimed = readInlineStyleKeys(ssrContext);
	const stylesheet = claimed
		? findIslandStylesheet(props.framework, props.component)
		: undefined;
	if (!claimed || !stylesheet || claimed.has(stylesheet.key)) return null;
	claimed.add(stylesheet.key);
	const nonce = readIslandStyleNonce();

	return {
		'data-island-style': stylesheet.key,
		href: stylesheet.href,
		...(nonce ? { nonce } : {}),
		rel: 'stylesheet'
	};
};

/** Browser: the props of the link the server rendered before this island, so hydration
 *  finds the same nodes; null when there is none (the server rendered the
 *  island without one, or this is a browser-only render, where the island
 *  runtime links the stylesheet itself). The nonce is left out: browsers
 *  hide it once applied, and Vue only compares the props given here. */
export const hydratedIslandStyleLink = (props: RuntimeIslandRenderProps) => {
	const link = claimServerIslandStyleLink(props);

	return link
		? {
				'data-island-style': link.key,
				href: link.href,
				rel: 'stylesheet'
			}
		: null;
};

type IslandStyleLinkProps = Record<string, string>;

/** The Island's root: its stylesheet link (when it has one) and the
 *  island element, as one fragment. */
export const withIslandStyleLink = (
	link: IslandStyleLinkProps | null,
	island: VNode
) => (link ? [h('link', link), island] : island);
