import { SvelteComponent, type Snippet } from 'svelte';
import type { RouterMode } from '../../../types/svelteRouter';

type RouterProps = {
	url?: string;
	basepath?: string;
	mode?: RouterMode;
	children?: Snippet;
};

declare const __propDef: { props: RouterProps };
type Props = typeof __propDef.props;

class Router extends SvelteComponent<Props> {}

export { Router as default };
