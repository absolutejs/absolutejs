export { Head } from './Head';
export { Image } from './Image';
export { JsonLd } from './JsonLd';
export { SuspenseSlot } from './SuspenseSlot';
export { StreamSlot } from './StreamSlot';
/* Prefetching `<Link>` and its hook also live here, not just on the
 * `react/router` subpath: that barrel statically imports react-router, so
 * a project without an SPA shell would have to install it just to get a
 * prefetching anchor. `<Link>` itself has no react-router import — it
 * reads the navigation context react-router's `<UniversalRouter>`
 * publishes and falls back to a plain navigation when there is none. */
export { Link } from '../router/Link';
export type { LinkProps } from '../router/Link';
export { usePrefetch } from '../hooks/usePrefetch';
export type { UsePrefetchOptions } from '../hooks/usePrefetch';
export type { PrefetchKind, PrefetchMode } from '../../../types/prefetch';
