/* Framework internal type definitions for HMR state extraction
   
   WARNING: These types represent framework internals that are not part of
   the public API. They may change between framework versions and should be
   used with caution. These are only used for state preservation during HMR.
   
   @internal
*/

/* React Fiber internals for state extraction */
export interface ReactFiber {
  memoizedState?: ReactFiberHook | null;
  memoizedProps?: Record<string, unknown> | null;
  child?: ReactFiber | null;
  sibling?: ReactFiber | null;
}

export interface ReactFiberHook {
  memoizedState?: unknown;
  next?: ReactFiberHook | null;
}

/* Vue component internals */
export interface VueComponentInternal {
  proxy?: {
    count?: number;
    isOpen?: boolean;
    activeTab?: string | number;
    selectedItem?: unknown;
    [key: string]: unknown;
  };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/* Svelte component internals */
export interface SvelteComponentInternal {
  $$?: {
    ctx?: unknown[];
    [key: string]: unknown;
  };
  $$scope?: unknown;
  $destroy?: () => void;
  [key: string]: unknown;
}

