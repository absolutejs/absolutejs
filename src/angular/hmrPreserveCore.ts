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

const isRebootFlag = (value: unknown): value is RebootFlag =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'value') === 'boolean';
const isRebootStats = (value: unknown): value is RebootStats =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'captured') === 'number' &&
	Reflect.get(value, 'restoredKeys') instanceof Set;

export const buildCacheKey = (instance: object, key?: unknown) => {
	const className = instance.constructor?.name;
	if (!className || className === 'Object') return null;
	const suffix = key === undefined || key === null ? '' : String(key);

	return `${className}:${suffix}`;
};
export const captureTrackedInstanceStates = () => {
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
			const value = Reflect.get(instance, prop);
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
export const endHmrReboot = () => {
	if (!isHmrPreserveDev()) return;
	getRebootFlag().value = false;

	const stats = getRebootStats();
	if (stats.captured > 0) {
		const restored = Array.from(stats.restoredKeys)
			.map((cacheKey) => cacheKey.replace(/:$/, ''))
			.sort();
		console.info(
			`[HMR] Full re-bootstrap: restored state for ${restored.length}/${stats.captured} tracked instance(s)${
				restored.length > 0 ? ` — ${restored.join(', ')}` : ''
			}. Components without preservation reset to defaults; opt in via \`preserveAcrossHmr(this)\`.`
		);
	}
};
export const getCache = () => {
	const current: unknown = Reflect.get(
		globalThis,
		'__ABS_HMR_INSTANCE_STATE__'
	);
	if (current instanceof Map) return current;
	const cache: StateCache = new Map();
	Reflect.set(globalThis, '__ABS_HMR_INSTANCE_STATE__', cache);

	return cache;
};
export const getKeyMap = () => {
	const current: unknown = Reflect.get(
		globalThis,
		'__ABS_HMR_INSTANCE_KEYS__'
	);
	if (current instanceof WeakMap) return current;
	const keyMap: InstanceKeyMap = new WeakMap();
	Reflect.set(globalThis, '__ABS_HMR_INSTANCE_KEYS__', keyMap);

	return keyMap;
};
export const getRebootFlag = () => {
	const current: unknown = Reflect.get(
		globalThis,
		'__ABS_HMR_REBOOT_IN_PROGRESS__'
	);
	if (isRebootFlag(current)) return current;
	const flag: RebootFlag = { value: false };
	Reflect.set(globalThis, '__ABS_HMR_REBOOT_IN_PROGRESS__', flag);

	return flag;
};
export const getRebootStats = () => {
	const current: unknown = Reflect.get(
		globalThis,
		'__ABS_HMR_REBOOT_STATS__'
	);
	if (isRebootStats(current)) return current;
	const stats: RebootStats = {
		captured: 0,
		restoredKeys: new Set()
	};
	Reflect.set(globalThis, '__ABS_HMR_REBOOT_STATS__', stats);

	return stats;
};
export const getTracker = () => {
	const current: unknown = Reflect.get(
		globalThis,
		'__ABS_HMR_TRACKED_INSTANCES__'
	);
	if (current instanceof Set) return current;
	const tracker: InstanceTracker = new Set();
	Reflect.set(globalThis, '__ABS_HMR_TRACKED_INSTANCES__', tracker);

	return tracker;
};
export const isHmrPreserveDev = () => {
	// SSR safety: globalThis on the server is process-wide and shared
	// across requests, so writing to the preservation cache during SSR
	// would leak request state between users. Gate strictly on the
	// presence of a browser `window` *and* a dev signal — neither is
	// true in a production build, so this is a hard no-op there too.
	if (typeof window === 'undefined') return false;

	return (
		Boolean(Reflect.get(globalThis, '__DEV__')) ||
		Boolean(Reflect.get(globalThis, 'ngDevMode'))
	);
};
export const isPreservable = (value: unknown, depth = 0): boolean => {
	if (depth > 8) return false;
	if (value === null || value === undefined) return true;
	const valueType = typeof value;
	if (
		valueType === 'string' ||
		valueType === 'number' ||
		valueType === 'boolean' ||
		valueType === 'bigint'
	)
		return true;
	if (valueType === 'function' || valueType === 'symbol') return false;
	if (Array.isArray(value)) {
		return value.every((item) => isPreservable(item, depth + 1));
	}
	if (valueType === 'object') {
		const proto = Object.getPrototypeOf(value);
		// Only POJOs — class instances (HttpClient, BehaviorSubject, Date,
		// Map, etc.) carry runtime identity that the new instance must
		// get from its own injector / construction.
		if (proto !== Object.prototype && proto !== null) return false;

		return Object.values(value).every((nestedValue) =>
			isPreservable(nestedValue, depth + 1)
		);
	}

	return false;
};
export const restoreFromCacheCore = (instance: object, key: string) => {
	const cache = getCache();
	const stored = cache.get(key);
	if (!stored) return false;

	for (const [prop, value] of Object.entries(stored)) {
		try {
			Reflect.set(instance, prop, value);
		} catch {
			/* property is non-writable / has a setter that threw — skip */
		}
	}

	getRebootStats().restoredKeys.add(key);

	return true;
};
