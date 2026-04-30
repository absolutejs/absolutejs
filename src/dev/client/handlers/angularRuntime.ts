/* Angular HMR — Zoneless Runtime Preservation
   DEV MODE ONLY — never included in production builds.

   Runtime component patching via prototype swap and ɵcmp metadata swap.
   State persists naturally via instance continuity — NO serialization.

   Why state serialization was removed:
     Angular component + service state lives on JS object instances.
     Prototype swapping replaces method implementations without destroying
     instances, so all state (properties, injected services, etc.) survives.
     Serializing and reassigning state is fragile, lossy, and unnecessary.

   Why zoneless requires manual tick():
     With provideZonelessChangeDetection(), there is no Zone.js to
     auto-trigger change detection. After swapping prototypes or templates,
     we must explicitly call ApplicationRef.tick() to re-render.

   Why this is safe in a multi-framework environment:
     This module only touches Angular-specific globals (__ANGULAR_APP__,
     __ANGULAR_HMR__). It never modifies document.body, React roots,
     Vue instances, or Svelte components. The registry is keyed by
     source file path, so name collisions across frameworks are impossible. */

type AngularComponentDefinition = {
	providers?: unknown;
	providersResolver?: unknown;
	selectors?: unknown[];
};

type ComponentCtor = (abstract new (...args: never[]) => unknown) & {
	ɵcmp?: AngularComponentDefinition;
	ɵfac?: unknown;
	ɵinj?: AngularComponentDefinition;
};

const isComponentCtor = (value: unknown): value is ComponentCtor =>
	typeof value === 'function';

type RegistryEntry = {
	liveCtor: ComponentCtor;
	id: string;
	registeredAt: number;
	updateCount: number;
};

type AngularHmrStats = {
	readonly componentCount: number;
	readonly updateCount: number;
};

/* The component registry MUST persist across chunk imports.
   Each compiled page chunk inlines this `angularRuntime.ts` module — when
   the HMR fast-patch dynamically `import()`s a new chunk, that chunk's
   inlined runtime evaluates again. Without a window-level singleton, each
   re-import would create a fresh `componentRegistry` Map, wipe out
   prior registrations, and break subsequent fast-patches (the second
   patch wouldn't find any registered components).
   We anchor the registry on `globalThis.__ANGULAR_HMR_REGISTRY__` so every
   chunk sees the same Map. */
type GlobalRegistryWindow = typeof globalThis & {
	__ANGULAR_HMR_REGISTRY__?: Map<string, RegistryEntry>;
	__ANGULAR_HMR_UPDATE_COUNT__?: { value: number };
};

const globalScope = globalThis as GlobalRegistryWindow;

const componentRegistry: Map<string, RegistryEntry> =
	globalScope.__ANGULAR_HMR_REGISTRY__ ??
	(globalScope.__ANGULAR_HMR_REGISTRY__ = new Map<string, RegistryEntry>());

const updateCounter: { value: number } =
	globalScope.__ANGULAR_HMR_UPDATE_COUNT__ ??
	(globalScope.__ANGULAR_HMR_UPDATE_COUNT__ = { value: 0 });

/* Cheap structural fingerprint. Functions render as 'fn' (treated as
   opaque — they change on every module reload but the static config
   like provider tokens, useValue payloads, etc. is what we care
   about). Objects walk depth-bounded with sorted keys so key order
   doesn't cause spurious diffs. Used both for component-level
   provider arrays and for page-level `routes`/`providers` exports. */
const fingerprint = (value: unknown, depth = 0): string => {
	if (depth > 6) return '~deep~';
	if (value === null) return 'null';
	if (value === undefined) return 'undef';
	if (typeof value === 'function') return 'fn';
	if (typeof value === 'symbol') return value.toString();
	if (Array.isArray(value)) {
		return (
			'[' + value.map((v) => fingerprint(v, depth + 1)).join(',') + ']'
		);
	}
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const entries = Object.entries(obj)
			.map(([k, v]): [string, string] => [k, fingerprint(v, depth + 1)])
			.sort(([a], [b]) => a.localeCompare(b));

		return '{' + entries.map(([k, v]) => `${k}:${v}`).join(',') + '}';
	}

	return JSON.stringify(value);
};

const hasInjectorProviderChanges = (
	oldCtor: ComponentCtor,
	newCtor: ComponentCtor
) => {
	if (oldCtor.ɵinj === undefined || newCtor.ɵinj === undefined) return false;
	const oldP = oldCtor.ɵinj?.providers;
	const newP = newCtor.ɵinj?.providers;
	if (!Array.isArray(oldP) || !Array.isArray(newP)) return false;

	return fingerprint(oldP) !== fingerprint(newP);
};

const hasComponentProviderChanges = (
	oldCtor: ComponentCtor,
	newCtor: ComponentCtor
) => {
	if (!oldCtor.ɵcmp || !newCtor.ɵcmp) return false;
	const oldResolver = oldCtor.ɵcmp.providersResolver;
	const newResolver = newCtor.ɵcmp.providersResolver;
	// Defined-ness flip — added/removed `providers: [...]` entirely.
	if ((oldResolver === undefined) !== (newResolver === undefined))
		return true;
	if (typeof oldResolver !== 'function' || typeof newResolver !== 'function')
		return false;

	// `providersResolver` is the function the Angular compiler emits to
	// merge a component's `providers` array into the element injector.
	// Its source body inlines the provider tokens and useValue/useFactory
	// references, so a change to the user's `providers: [...]` array
	// produces a different function body. Comparing `toString()` catches
	// content changes that the old length/defined-ness check missed —
	// e.g. swapping `useValue: 'foo'` for `useValue: 'bar'` while
	// keeping the array length identical.
	return oldResolver.toString() !== newResolver.toString();
};

const hasProviderChanges = (oldCtor: ComponentCtor, newCtor: ComponentCtor) => {
	if (hasInjectorProviderChanges(oldCtor, newCtor)) return true;
	if (hasComponentProviderChanges(oldCtor, newCtor)) return true;

	return false;
};

const register = (id: string, ctor: unknown) => {
	if (!id || !isComponentCtor(ctor)) return;
	if (!componentRegistry.has(id)) {
		componentRegistry.set(id, {
			id,
			liveCtor: ctor,
			registeredAt: Date.now(),
			updateCount: 0
		});
	}
};

const SKIP_STATIC_PROPS = [
	'prototype',
	'length',
	'name',
	'caller',
	'arguments'
];

const swapPrototypeProp = (
	liveCtor: ComponentCtor,
	newProto: ComponentCtor,
	prop: string
) => {
	if (prop === 'constructor') return;
	try {
		const desc = Object.getOwnPropertyDescriptor(newProto, prop);
		if (desc) Object.defineProperty(liveCtor.prototype, prop, desc);
	} catch {
		/* non-configurable */
	}
};

const swapStaticProp = (
	liveCtor: ComponentCtor,
	newCtor: ComponentCtor,
	prop: string
) => {
	if (SKIP_STATIC_PROPS.includes(prop)) return true;
	try {
		const desc = Object.getOwnPropertyDescriptor(newCtor, prop);
		if (!desc) return true;
		if (!desc.configurable) return prop !== 'ɵcmp' && prop !== 'ɵfac';
		Object.defineProperty(liveCtor, prop, desc);

		return true;
	} catch {
		return prop !== 'ɵcmp' && prop !== 'ɵfac';
	}
};

const patchConstructor = (entry: RegistryEntry, newCtor: ComponentCtor) => {
	const { liveCtor } = entry;

	const newProto = newCtor.prototype;
	Object.getOwnPropertyNames(newProto).forEach((prop) => {
		swapPrototypeProp(liveCtor, newProto, prop);
	});

	const allPatched = Object.getOwnPropertyNames(newCtor).every((prop) =>
		swapStaticProp(liveCtor, newCtor, prop)
	);

	if (!allPatched) {
		throw new Error('Cannot patch non-configurable Angular metadata');
	}

	updateCounter.value++;
	entry.updateCount++;
	entry.registeredAt = Date.now();
};

/* The fast-patch swap of `ɵcmp` and prototype methods doesn't mark
   live OnPush components as dirty — `applicationRef.tick()` alone
   only checks views that are already marked dirty. So a template
   edit on an OnPush component would silently fail to render until
   the user clicked something that triggered a markForCheck.
   We collect every successfully-patched ctor here, then `refresh()`
   walks the DOM for each ctor's selector, gets the live instance via
   the `ng` debug API, and calls `applyChanges` on it (which marks
   the view dirty AND runs CD on its subtree). */
const pendingFastPatchRefresh: Set<ComponentCtor> = new Set();

type AngularDebugWindow = Window & {
	ng?: {
		applyChanges?: (component: unknown) => void;
		getComponent?: (element: Element) => unknown;
	};
};

const componentTagSelectors = (ctor: ComponentCtor): string[] => {
	const selectors = ctor.ɵcmp?.selectors;
	if (!Array.isArray(selectors)) return [];
	const tags: string[] = [];
	for (const tuple of selectors) {
		if (!Array.isArray(tuple)) continue;
		const head = tuple[0];
		// Component selectors lead with the tag name (a hyphenated
		// element name); attribute selectors lead with `''`. Skip the
		// attribute case — those are directives, not OnPush views.
		if (typeof head === 'string' && head.includes('-')) tags.push(head);
	}

	return tags;
};

const markPatchedDirty = (ctor: ComponentCtor) => {
	const ng = (window as AngularDebugWindow).ng;
	if (!ng?.getComponent || !ng?.applyChanges) return;
	for (const tag of componentTagSelectors(ctor)) {
		document.querySelectorAll(tag).forEach((el) => {
			try {
				const instance = ng.getComponent?.(el);
				if (instance) ng.applyChanges?.(instance);
			} catch {
				/* dev-only debug API — ignore failures */
			}
		});
	}
};

const applyUpdate = (id: string, newCtor: unknown) => {
	if (!isComponentCtor(newCtor)) return false;

	const entry = componentRegistry.get(id);
	if (!entry) {
		register(id, newCtor);

		return true;
	}

	const { liveCtor } = entry;
	if (liveCtor === newCtor) return true;

	if (hasProviderChanges(liveCtor, newCtor)) {
		console.warn(
			'[HMR] Angular provider change detected for',
			id,
			'→ full reload'
		);

		return false;
	}
	if (newCtor.ɵcmp === undefined && liveCtor.ɵcmp !== undefined) {
		console.warn(
			'[HMR] New constructor missing ɵcmp for',
			id,
			'→ full reload'
		);

		return false;
	}

	try {
		patchConstructor(entry, newCtor);
		// Queue this ctor for `refresh()` to mark its live instances
		// dirty — the patch swapped metadata in place, but OnPush
		// components need an explicit markForCheck to re-render.
		// `liveCtor` is the on-page constructor (we patched into it);
		// we use that for selector lookup since the swap may have
		// updated `ɵcmp` on `liveCtor` itself.
		pendingFastPatchRefresh.add(liveCtor);

		return true;
	} catch (err) {
		console.error('[HMR] Angular runtime patch failed for', id, ':', err);

		return false;
	}
};

const refresh = () => {
	if (!window.__ANGULAR_APP__) return;
	// Mark every live instance of every patched component dirty before
	// ticking. `tick()` alone wouldn't re-render OnPush components,
	// since they only re-check on `markForCheck`. `applyChanges` marks
	// the view dirty and runs CD on its subtree — covers both OnPush
	// and Default change-detection components correctly.
	for (const ctor of pendingFastPatchRefresh) {
		markPatchedDirty(ctor);
	}
	pendingFastPatchRefresh.clear();
	try {
		window.__ANGULAR_APP__.tick();
	} catch (err) {
		console.warn('[HMR] Angular tick() failed after patch:', err);
	}
};

const angularHmrStats: AngularHmrStats = {
	get componentCount() {
		return componentRegistry.size;
	},
	get updateCount() {
		return updateCounter.value;
	}
};

const getAngularHmrStats = () => angularHmrStats;

/* Page-level export fingerprints — detect when `routes` or `providers`
   change in a page file so the HMR fast-patch can fall back to a full
   re-bootstrap. Without this, a component-level fast-patch silently
   succeeds while the route/provider change is left dangling — the
   running router/injector still uses the values from the initial
   bootstrap. The page chunk template calls `recordPageExports` on every
   evaluation (initial bootstrap and HMR re-imports); the fast-patch
   handler then checks `hasPageExportsChanged` to decide whether to
   force a full re-bootstrap.
   Function references are treated as opaque — they change on every
   module reload but the static config (`path`, `pathMatch`, provider
   token, useValue, etc.) is what we care about. */

type PageFingerprint = {
	routes: string | null;
	providers: string | null;
};

type PageExportRecord = {
	current: PageFingerprint;
	previous: PageFingerprint | null;
};

const pageExportRecords = ((
	globalThis as { __ABS_HMR_PAGE_EXPORTS__?: Map<string, PageExportRecord> }
).__ABS_HMR_PAGE_EXPORTS__ ??= new Map<string, PageExportRecord>());

const recordPageExports = (
	sourceId: string,
	routes: unknown,
	providers: unknown
) => {
	const next: PageFingerprint = {
		routes: routes === undefined ? null : fingerprint(routes),
		providers: providers === undefined ? null : fingerprint(providers)
	};
	const existing = pageExportRecords.get(sourceId);
	pageExportRecords.set(sourceId, {
		current: next,
		previous: existing?.current ?? null
	});
};

const hasPageExportsChanged = (sourceId: string): boolean => {
	const record = pageExportRecords.get(sourceId);
	if (!record || !record.previous) return false;

	return (
		record.previous.routes !== record.current.routes ||
		record.previous.providers !== record.current.providers
	);
};

export const installAngularHMRRuntime = () => {
	if (typeof window === 'undefined') return;
	window.__ANGULAR_HMR__ = {
		applyUpdate,
		getStats: getAngularHmrStats,
		hasPageExportsChanged,
		recordPageExports,
		refresh,
		register,
		getRegistry: () => componentRegistry
	};
};

installAngularHMRRuntime();
