/* Vendored LView slot indices from `@angular/core`. The runtime represents
 * each LView as a flat array; these constants name the structural slots
 * before the per-template slots start at HEADER_OFFSET.
 *
 * Source: `node_modules/@angular/core/fesm2022/_effect-chunk2.mjs`
 * (search for `const HOST = 0;`). These are NOT exported and Angular keeps
 * them tightly held — but they have not shifted since the v9 ivy rewrite,
 * so the maintenance cost is verifying once per Angular minor that
 *   `_effect-chunk2.mjs:HOST === 0` etc. still holds.
 *
 * If Angular reorders these, our LView traversal returns wrong slots
 * (e.g. reading PARENT might yield CONTEXT). Symptom: per-component
 * remount throws or silently swaps the wrong subtree. Verify at the
 * top of `angularRemount.ts` via shape checks before doing anything
 * destructive. */

export const HOST = 0;
export const TVIEW = 1;
export const FLAGS = 2;
export const PARENT = 3;
export const NEXT = 4;
export const T_HOST = 5;
export const HYDRATION = 6;
export const CLEANUP = 7;
export const CONTEXT = 8;
export const INJECTOR = 9;
export const ENVIRONMENT = 10;
export const RENDERER = 11;
export const CHILD_HEAD = 12;
export const CHILD_TAIL = 13;
export const DECLARATION_VIEW = 14;
export const DECLARATION_COMPONENT_VIEW = 15;
export const DECLARATION_LCONTAINER = 16;
export const PREORDER_HOOK_FLAGS = 17;
export const QUERIES = 18;
export const ID = 19;
export const EMBEDDED_VIEW_INJECTOR = 20;
export const ON_DESTROY_HOOKS = 21;
export const HEADER_OFFSET = 27;

/* LView FLAGS bitfield bits (from same source). We only care about
 * the destroyed bit so that double-destroy is a no-op. */
export const LFLAG_DESTROYED = 256;
