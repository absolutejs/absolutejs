/* Shared by the React Server Components build pass and page handler. */

/** Manifest key of the browser entry that hydrates every RSC page. */
export const REACT_SERVER_CLIENT_MANIFEST_KEY = 'ReactServerClient';
/** `asset(manifest, '<Page>RSC')` names a page's react-server bundle. A
 *  page whose name already ends in RSC is not suffixed twice. */
export const REACT_SERVER_PAGE_MANIFEST_SUFFIX = 'RSC';
/** Global array the inline Flight payload scripts push into. */
export const REACT_SERVER_PAYLOAD_GLOBAL = '__absoluteReactServerPayload';
/** Manifest key of the server bundle that renders Flight to HTML. */
export const REACT_SERVER_RENDERER_MANIFEST_KEY = 'ReactServerRenderer';
/** Written next to the react-server page bundles: where the SSR renderer and
 *  the hydration entry of the same build live. */
export const REACT_SERVER_RUNTIME_FILE = 'react-server-runtime.json';
