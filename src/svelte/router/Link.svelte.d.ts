import type { Snippet } from 'svelte';
import type { LinkPrefetchMode } from '../../../types/svelteRouter';

type LinkProps = {
	to: string;
	replaceState?: boolean;
	prefetch?: LinkPrefetchMode;
	keepFocus?: boolean;
	noScroll?: boolean;
	class?: string;
	target?: string;
	children?: Snippet;
	[key: string]: unknown;
};

declare const __propDef: { props: LinkProps };
type Props = typeof __propDef.props;

import { SvelteComponent } from 'svelte';

export default class Link extends SvelteComponent<Props> {}
