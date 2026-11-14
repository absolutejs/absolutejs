'use client';

/* The parts of `@absolutejs/absolute/react/components` that need client
 * React (context, refs, effects). Shipped as its own file with a
 * "use client" directive so the server components entry (./server) can
 * re-export them: a React Server Components build turns them into client references
 * instead of evaluating them against React's server build, which has no
 * createContext. */
export { Link } from '../router/Link';
export type { LinkProps } from '../router/Link';
export { usePrefetch } from '../hooks/usePrefetch';
export type { UsePrefetchOptions } from '../hooks/usePrefetch';
