/* preserveAcrossHmr — keep service AND component instance state alive
   across full Angular re-bootstraps in dev mode.

   Why this exists: most HMR updates use fast-patch (in-place prototype
   swap) and never destroy the running app, so instance state is never
   lost. But some changes — route definitions, providers, brand-new
   components, anything in a `providedIn: 'root'` provider list —
   require the HMR client to fall back to a full re-bootstrap. That
   destroys every service and component instance, and the new ones
   start with class field initializers (e.g. `idToken: null`,
   `searchQuery: ''`). Anything held in memory (auth tokens, cached
   query results, form input values, scroll-positioned filters) gets
   wiped, even though the underlying source of truth (Firebase session,
   the URL, the user's intent) hasn't changed.

   Usage — opt in once per class:

       // Service (singleton, no key needed)
       @Injectable({ providedIn: 'root' })
       export class AuthService {
           idToken: string | null = null;

           constructor() {
               preserveAcrossHmr(this);
           }
       }

       // Component (one instance per route, no key needed)
       @Component({ ... })
       export class AdminProfilesComponent {
           searchQuery = '';
           currentPage = 0;

           constructor() {
               preserveAcrossHmr(this);
           }
       }

       // Component with multiple instances on the same page — pass a
       // key derived from @Input. Use ngOnInit because Angular sets
       // @Input properties between constructor and ngOnInit.
       @Component({ ... })
       export class ItemRowComponent implements OnInit {
           @Input() id!: string;
           expanded = false;

           ngOnInit() {
               preserveAcrossHmr(this, this.id);
           }
       }

   The shared capture/restore plumbing lives in `./hmrPreserveCore.ts`
   so the dev-client HMR handler can call it without pulling Angular
   into its bundle. This file adds the user-facing API plus an
   automatic OnPush `markForCheck` so restored state actually paints. */

import { ChangeDetectorRef, inject } from '@angular/core';

import {
	buildCacheKey,
	getKeyMap,
	getRebootFlag,
	getTracker,
	isHmrPreserveDev,
	restoreFromCacheCore
} from './hmrPreserveCore';

/** Mark a service or component instance for state preservation across
 *  full Angular HMR re-bootstraps. Call once from the constructor or
 *  `ngOnInit`. Safe in production (no-op outside dev mode).
 *
 *  @param instance Usually `this`. The class name is used as part of
 *      the cache key.
 *  @param key Optional discriminator when multiple instances of the
 *      same class can be alive at once (rows, tabs, etc). Coerced
 *      to string. Use `ngOnInit` to call this when the key depends
 *      on `@Input` values, since Angular sets inputs between
 *      constructor and ngOnInit. */
export const preserveAcrossHmr = (
	instance: object,
	key?: string | number
): void => {
	if (!isHmrPreserveDev()) return;

	const fullKey = buildCacheKey(instance, key);
	if (fullKey === null) return;

	// Always register for future capture — independent of whether a
	// reboot is currently in progress. The next capture cycle will
	// snapshot whatever's in the tracker. Store the key alongside the
	// instance via WeakMap so capture knows which cache slot to use
	// without instance pollution.
	// Idempotent on `instance` identity: `new WeakRef(x)` is a fresh
	// wrapper each call, and `Set` dedupes by wrapper-reference equality
	// (not by what the WeakRef points to) — so a naive `tracker.add` on
	// every call would register the same instance twice if the user
	// called `preserveAcrossHmr(this)` from both the constructor and
	// `ngOnInit`. That'd then trip the collision warning during capture
	// (two refs derefing to one instance, both mapping to the same
	// `${className}:${key}` slot). Use the keymap as the
	// "already-registered" indicator: if it has the instance, we've
	// added a tracker entry before. The keymap setter still runs so
	// repeated calls can update the key (e.g. `ngOnInit` refining the
	// constructor's keyless registration with an `@Input`-derived key).
	const keyMap = getKeyMap();
	if (!keyMap.has(instance)) {
		getTracker().add(new WeakRef(instance));
	}
	keyMap.set(instance, fullKey);

	// Restoration is HMR-cycle-scoped. Outside an active reboot, the
	// new instance keeps its class-field defaults; we don't want stale
	// state from a previous HMR to leak into normal navigations.
	if (!getRebootFlag().value) return;

	const restored = restoreFromCacheCore(instance, fullKey);
	if (!restored) return;

	// OnPush components don't see direct property assignments — they
	// only re-check on `markForCheck()`. Restoration above happens
	// before the first CD pass on this instance, so on the *initial*
	// render OnPush is fine; but if `preserveAcrossHmr` is called from
	// `ngOnInit` (the keyed-component path), the parent's CD pass may
	// have already painted defaults. Schedule a markForCheck so the
	// restored values are visible without the user remembering to do
	// it themselves.
	// `inject()` requires an active injection context — true inside
	// constructors, factories, and `runInInjectionContext` blocks. It
	// throws otherwise (e.g. called from a lifecycle hook), in which
	// case we skip cleanly; the component's own first CD pass will
	// pick up the values anyway.
	try {
		const cdr = inject(ChangeDetectorRef, { optional: true });
		if (cdr) queueMicrotask(() => cdr.markForCheck());
	} catch {
		/* outside injection context / no CDR available — fine */
	}
};
