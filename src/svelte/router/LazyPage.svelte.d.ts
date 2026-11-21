import { SvelteComponent } from 'svelte';
import type { LazyRouteLoader } from '../../../types/svelteRouter';

type LazyPageProps = {
	id: string;
	loader: LazyRouteLoader;
	props?: Record<string, unknown>;
};

declare const __propDef: { props: LazyPageProps };
type Props = typeof __propDef.props;

/** Written by the build for a route page inside a wrapper; not for apps. */
class LazyPage extends SvelteComponent<Props> {}
export { LazyPage as default };
