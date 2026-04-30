/* hmrPreserveCore — shared HMR preservation utilities, with no Angular
   imports. Used by both `preserveAcrossHmr` (the user-facing helper that
   adds OnPush `markForCheck` behavior on top) and the dev-client HMR
   handler (which calls `captureTrackedInstanceStates` before destroying
   the running app and `endHmrReboot` once the new app has stabilized).

   Splitting these out lets the dev-client HMR handler — which has no
   need for `@angular/core` — call into the same capture/restore logic
   as the user-facing helper without forcing an Angular core import into
   the dev-client bundle. The state itself lives on `globalThis`, so
   both consumers see exactly the same tracker / cache / flag. */

export type StateCache = Map<string, Record<string, unknown>>;
export type InstanceTracker = Set<WeakRef<object>>;
export type InstanceKeyMap = WeakMap<object, string>;
export type RebootFlag = { value: boolean };
export type RebootStats = { captured: number; restoredKeys: Set<string> };

type PreserveScope = typeof globalThis & {
	__ABS_HMR_INSTANCE_STATE__?: StateCache;
	__ABS_HMR_TRACKED_INSTANCES__?: InstanceTracker;
	__ABS_HMR_INSTANCE_KEYS__?: InstanceKeyMap;
	__ABS_HMR_REBOOT_IN_PROGRESS__?: RebootFlag;
	__ABS_HMR_REBOOT_STATS__?: RebootStats;
};

export const isHmrPreserveDev = (): boolean => {
	// SSR safety: globalThis on the server is process-wide and shared
	// across requests, so writing to the preservation cache during SSR
	// would leak request state between users. Gate strictly on the
	// presence of a browser `window` *and* a dev signal — neither is
	// true in a production build, so this is a hard no-op there too.
	if (typeof window === 'undefined') return false;
	const scope = globalThis as { __DEV__?: unknown; ngDevMode?: unknown };

	return Boolean(scope.__DEV__) || Boolean(scope.ngDevMode);
};

export const getCache = (): StateCache => {
	const scope = globalThis as PreserveScope;

	return (scope.__ABS_HMR_INSTANCE_STATE__ ??= new Map());
};

export const getTracker = (): InstanceTracker => {
	const scope = globalThis as PreserveScope;

	return (scope.__ABS_HMR_TRACKED_INSTANCES__ ??= new Set());
};

export const getKeyMap = (): InstanceKeyMap => {
	const scope = globalThis as PreserveScope;

	return (scope.__ABS_HMR_INSTANCE_KEYS__ ??= new WeakMap());
};

export const getRebootFlag = (): RebootFlag => {
	const scope = globalThis as PreserveScope;

	return (scope.__ABS_HMR_REBOOT_IN_PROGRESS__ ??= { value: false });
};

export const getRebootStats = (): RebootStats => {
	const scope = globalThis as PreserveScope;

	return (scope.__ABS_HMR_REBOOT_STATS__ ??= {
		captured: 0,
		restoredKeys: new Set()
	});
};

/* Filter for values that are safe to preserve across an HMR full
   re-bootstrap. Snapshots the OLD app's instance state into a cache
   and copies it back onto the NEW instance — but holding references
   to the OLD app's Angular-injected services (HttpClient,
   ApplicationRef, subscriptions tied to the destroyed injector, etc.)
   and restoring them onto the new instance would corrupt the new app:
   the new `HttpClient` from the new injector would be replaced by a
   stale ref pointing at a destroyed graph. So: primitives, plain `{}`
   objects, and arrays of those — covers the common cases (auth tokens,
   cached query results, search queries, pagination state) without
   leaking Angular-injected dependencies, RxJS subjects, DOM nodes, or
   other live references. */
export const isPreservable = (value: unknown, depth = 0): boolean => {
	if (depth > 8) return false;
	if (value === null || value === undefined) return true;
	const t = typeof value;
	if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint')
		return true;
	if (t === 'function' || t === 'symbol') return false;
	if (Array.isArray(value)) {
		return value.every((item) => isPreservable(item, depth + 1));
	}
	if (t === 'object') {
		const proto = Object.getPrototypeOf(value);
		// Only POJOs — class instances (HttpClient, BehaviorSubject, Date,
		// Map, etc.) carry runtime identity that the new instance must
		// get from its own injector / construction.
		if (proto !== Object.prototype && proto !== null) return false;

		return Object.values(value as object).every((v) =>
			isPreservable(v, depth + 1)
		);
	}

	return false;
};

export const buildCacheKey = (
	instance: object,
	key?: unknown
): string | null => {
	const className = instance.constructor?.name;
	if (!className || className === 'Object') return null;
	const suffix = key === undefined || key === null ? '' : String(key);

	return `${className}:${suffix}`;
};

/** Copy preservable own properties from the cached snapshot onto the
 *  instance. Records the restoration in stats so the end-of-reboot
 *  summary can list which classes had state restored. Returns whether
 *  anything was actually written. */
export const restoreFromCacheCore = (
	instance: object,
	key: string
): boolean => {
	const cache = getCache();
	const stored = cache.get(key);
	if (!stored) return false;

	for (const [prop, value] of Object.entries(stored)) {
		try {
			(instance as Record<string, unknown>)[prop] = value;
		} catch {
			/* property is non-writable / has a setter that threw — skip */
		}
	}

	getRebootStats().restoredKeys.add(key);

	return true;
};

/** Snapshot every tracked instance's preservable own properties into
 *  the shared cache and flip the reboot-in-progress flag on. Called by
 *  the dev-client HMR handler right before `destroyAngularApp()`. */
export const captureTrackedInstanceStates = (): void => {
	if (!isHmrPreserveDev()) return;

	const cache = getCache();
	const tracker = getTracker();
	const keyMap = getKeyMap();
	const stats = getRebootStats();
	const seen = new Set<string>();

	cache.clear();
	stats.restoredKeys.clear();
	stats.captured = 0;

	for (const ref of tracker) {
		const instance = ref.deref();
		// Skip already-GC'd refs. We don't bother bookkeeping a "dead"
		// list because the entire tracker is cleared after this loop.
		if (!instance) continue;

		const fullKey = keyMap.get(instance) ?? buildCacheKey(instance);
		if (fullKey === null) continue;

		// Warn when two instances would collide on the same cache slot
		// (same className with no key, or duplicate user-supplied keys).
		// On collision the second instance's state silently overwrites
		// the first — pass an explicit `key` to differentiate.
		if (seen.has(fullKey)) {
			console.warn(
				`[HMR] preserveAcrossHmr collision on "${fullKey}". Two instances would use the same cache slot — the later one will overwrite the earlier one's state on full re-bootstrap. Pass a unique \`key\` argument (e.g. an @Input id) to differentiate.`
			);
		}
		seen.add(fullKey);

		const props: Record<string, unknown> = {};
		for (const prop of Object.keys(instance)) {
			const value = (instance as Record<string, unknown>)[prop];
			if (isPreservable(value)) props[prop] = value;
		}
		cache.set(fullKey, props);
		stats.captured++;
	}

	// Every instance just captured is about to die: `destroyAngularApp()`
	// runs immediately after this. New instances from the next bootstrap
	// repopulate the tracker via their own `preserveAcrossHmr(this)`
	// calls. Leaving existing WeakRefs in place means the JS engine
	// often won't have GC'd the old objects yet at the next capture —
	// those zombies inflate the captured count and trigger spurious
	// collision warnings against the new generation's instances.
	tracker.clear();

	getRebootFlag().value = true;
};

/** Clear the active-reboot flag and emit a one-line summary so
 *  developers can see at-a-glance which classes had state preserved.
 *  Called by the dev-client HMR handler after the new app has reported
 *  stable. After this, `preserveAcrossHmr` calls track but don't
 *  restore — so navigating to a route after HMR doesn't resurrect
 *  stale state from the last reboot. */
export const endHmrReboot = (): void => {
	if (!isHmrPreserveDev()) return;
	getRebootFlag().value = false;

	const stats = getRebootStats();
	if (stats.captured > 0) {
		const restored = Array.from(stats.restoredKeys)
			.map((k) => k.replace(/:$/, ''))
			.sort();
		console.info(
			`[HMR] Full re-bootstrap: restored state for ${restored.length}/${stats.captured} tracked instance(s)${
				restored.length > 0 ? ` — ${restored.join(', ')}` : ''
			}. Components without preservation reset to defaults; opt in via \`preserveAcrossHmr(this)\`.`
		);
	}
};
