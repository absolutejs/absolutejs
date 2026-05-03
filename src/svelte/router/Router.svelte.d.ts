import type { Snippet } from 'svelte';
import type { RouterMode } from '../../../types/svelteRouter';

type RouterProps = {
	url?: string;
	basepath?: string;
	mode?: RouterMode;
	children?: Snippet;
};

declare const __propDef: { props: RouterProps };
type Props = typeof __propDef.props;

import { SvelteComponent } from 'svelte';

export default class Router extends SvelteComponent<Props> {}
