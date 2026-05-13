# Angular HMR

How `@absolutejs/absolute` keeps your Angular app responsive across edits in dev mode.

## TL;DR

For most edits — template changes, method bodies, decorator metadata, CSS — HMR runs an **in-place fast-patch**: components keep their instances, change detection re-renders, no state is lost. Auth tokens, scroll position, form values, route params — all preserved automatically.

For edits that change Angular's bootstrap-time config — `routes`, `providers`, never-seen components, certain provider list mutations — HMR falls back to a **full re-bootstrap**: the app is destroyed and recreated. By default, in-memory state is lost in that path. To opt instances back into preservation, call:

```ts
constructor() {
  preserveAcrossHmr(this);
}
```

That's it.

## When fast-patch runs (no opt-in needed)

- Component template changes
- Component method body changes
- `@Component({ ... })` metadata changes (selector, `changeDetection: OnPush`)
- CSS/SCSS changes (just swaps the stylesheet)
- Decorator changes (`@Input`, `@Output`, view children)

The component instance is preserved; only its prototype methods and `ɵcmp` metadata are swapped in place. State on the instance — class fields, form values, scroll position — survives without any helper.

## When full re-bootstrap runs

The fast-patch path can't apply when:

- The page module's `routes` or `providers` exports change (read once at bootstrap; changing them at runtime won't propagate to the running router/injector)
- A component-level `providers` array changes (provider injection happens once)
- A brand-new component is added that wasn't yet registered
- The HMR client detects a structural change it can't safely patch

In these cases, the entire Angular app is destroyed and re-bootstrapped. Without preservation, the new instances start with class-field defaults — auth tokens, cached query results, search filters, expanded panel state are all reset.

## Opting in: `preserveAcrossHmr(this)`

```ts
import { preserveAcrossHmr } from "@absolutejs/absolute/angular";
```

### Service (singleton)

```ts
@Injectable({ providedIn: "root" })
export class AuthService {
  idToken: string | null = null;
  user: User | null = null;

  constructor() {
    preserveAcrossHmr(this);
  }
}
```

After a full re-bootstrap, the new `AuthService` instance reads `idToken` and `user` back from the cache. Continue requests succeed; no flicker through the unauthenticated state.

### Page-level component (one instance per route)

```ts
@Component({ selector: "app-admin-profiles" /* … */ })
export class AdminProfilesComponent {
  searchQuery = "";
  currentPage = 0;
  sorts = [{ prop: "createdDate", dir: "desc" }];

  constructor() {
    preserveAcrossHmr(this);
  }
}
```

Search box content, pagination position, and sort order survive a full re-bootstrap. The DOM element shows the restored value; the live component instance has the restored properties.

### Component with multiple instances on the same page

When two or more instances of the same component class can be alive at once (rows, tabs, items in a list), pass a key derived from `@Input` to discriminate them. Use `ngOnInit` because Angular sets `@Input` properties between constructor and `ngOnInit`:

```ts
@Component({ selector: "app-item-row" /* … */ })
export class ItemRowComponent implements OnInit {
  @Input() id!: string;
  expanded = false;

  ngOnInit() {
    preserveAcrossHmr(this, this.id);
  }
}
```

If two instances would collide on the same cache slot (forgetting the key, or two duplicate keys), a console warning fires:

```
[HMR] preserveAcrossHmr collision on "ItemRowComponent:". Two instances would use the same cache slot — the later one will overwrite the earlier one's state on full re-bootstrap. Pass a unique `key` argument (e.g. an @Input id) to differentiate.
```

## What gets preserved

Only values that survive a clean re-creation of the new instance:

- Primitives (`string`, `number`, `boolean`, `bigint`, `null`, `undefined`)
- Plain `{}` objects (recursively)
- Arrays of preservable values

Excluded — the new instance gets these fresh from its own injector / construction:

- Class instances (`HttpClient`, `BehaviorSubject`, `FormGroup`, `Date`, `Map`, …)
- Functions
- Symbols

If you preserved an `HttpClient` reference from the old (destroyed) injector onto the new instance, the new instance would call into a dead injector graph. The filter prevents that — every framework-injected dependency comes fresh.

## Cache lifetime

The cache is **scoped to the HMR cycle**:

1. Capture runs at the start of the full re-bootstrap, snapshots all tracked instances, and flips `rebootInProgress = true`.
2. New instances created during bootstrap restore from cache via `preserveAcrossHmr`.
3. The flag is cleared when `applicationRef.whenStable()` resolves — i.e. when the new app has no pending microtasks, scheduled change detection, or in-flight lazy-chunk loads. This is event-based, not timer-based: lazy-route components have a guaranteed window to construct and read the cache, regardless of network speed. A 10-second fallback timer guards against `whenStable` never resolving (e.g. a long-running HTTP poll keeping pending tasks open).

Outside an active HMR cycle, `preserveAcrossHmr` only registers the instance for the *next* capture. It doesn't touch the current state.

## Where `preserveAcrossHmr(this)` belongs

- **Constructor** — for the common case (class fields with literal defaults). Class field initializers run before the constructor body, so the helper restores after defaults are set.
- **`ngOnInit`** — when the cache key depends on `@Input` properties. Angular sets `@Input` between constructor and `ngOnInit`.

Both are valid. Pick the one that matches your data dependencies.

## What `preserveAcrossHmr` won't do

### Restore `@Input`-bound properties

If a child component has `@Input() filter` and the parent passes the value down via template binding, the parent is the source of truth. Whatever you preserve gets overwritten by the next change-detection pass that flows the parent's binding down. Don't expect preservation to fight the data flow — use it for child-owned state.

### Restore from a previous HMR after a route change

Once `applicationRef.whenStable()` resolves, the cache is ignored. Navigating to a route after HMR loads fresh component state, not the cached state from before the reboot. This is intentional — the captured state belongs to the previous render context.

### Survive a server restart or `bun install`

The cache lives on `globalThis` in the browser tab. Reloading the page (`Cmd+R`) or restarting the dev server clears it. Preservation is for HMR cycles only.

## OnPush components

OnPush components only re-check on `markForCheck()`, not on direct property assignments. When `preserveAcrossHmr` restores state, it auto-detects whether it's running inside an Angular injection context (i.e. a constructor) and, if a `ChangeDetectorRef` is available, schedules a `markForCheck()` for the next microtask. This means OnPush pages get the restored values painted on the first CD cycle without any extra wiring.

If `preserveAcrossHmr(this, key)` is called from `ngOnInit` instead — required when the cache key depends on `@Input` values — Angular is no longer in an injection context and the auto-`markForCheck` is a no-op. Component construction triggers a CD pass anyway, so the restored values still appear on the first paint of the new render.

## Production safety

`preserveAcrossHmr` is a no-op outside dev mode. It checks for the presence of `window` (skipping SSR — `globalThis` is process-wide on the server, so writing into the cache there would leak request state between users), then `globalThis.ngDevMode` (truthy in dev) and `globalThis.__DEV__` (project-defined). In production builds none of these are set, the helper short-circuits, and there's no cache, no WeakRef tracking, no overhead.

## Reboot summary log

After every full re-bootstrap, the HMR client logs a one-line `console.info` summary listing how many tracked instances had state restored:

```
[HMR] Full re-bootstrap: restored state for 2/2 tracked instance(s) — AdminProfilesComponent, AuthService. Components without preservation reset to defaults; opt in via `preserveAcrossHmr(this)`.
```

This is intentionally surfaced so that if your auth flickered through unauthenticated, or your search box reset to empty after a route edit, you can see at-a-glance which classes opted into preservation and which didn't — and add `preserveAcrossHmr(this)` to the ones that should have. Fast-patches don't print this (no instance state is lost on fast-patch).

## Diagnostics

The current state of preservation is observable through `globalThis`:

```js
// In the browser console:
globalThis.__ABS_HMR_INSTANCE_STATE__         // Map<className:key, props>
globalThis.__ABS_HMR_TRACKED_INSTANCES__      // Set<WeakRef<instance>>
globalThis.__ABS_HMR_INSTANCE_KEYS__          // WeakMap<instance, fullKey>
globalThis.__ABS_HMR_REBOOT_IN_PROGRESS__     // { value: boolean }
```

Useful when debugging why a particular instance isn't restoring as expected. Check that the cache key matches what your `preserveAcrossHmr(this, key)` call would compute, and that the property you expected is in the captured snapshot (it has to pass the `isPreservable` filter described above).

## How fast-patch actually works (briefly)

1. The page chunk emitted by the build calls `window.__ANGULAR_HMR__.register(id, ComponentClass)` for each `*Component` export. This populates a registry keyed by source-file path.
2. On HMR, the client dynamically `import()`s the new chunk with a flag set so the chunk's bootstrap section is skipped — only the freshly-built component class references are evaluated.
3. The new class is patched onto the live class via `Object.defineProperty` swaps of `ɵcmp`, `ɵfac`, prototype methods. Existing instances keep their identity.
4. `applicationRef.tick()` triggers re-render with the new metadata.
5. If anything goes wrong (provider list changed, brand-new component, page-level `routes`/`providers` differ from the previous snapshot), the client falls back to the full re-bootstrap path described above.

The fingerprint check that decides between fast-patch and full reboot compares structural shapes of `routes` and `providers` arrays (function references treated as opaque, so a `loadComponent: () => import(...)` doesn't false-positive). If your edit only touches the component class body, fast-patch applies. If it changes route paths or provider tokens, you get the full reboot.
