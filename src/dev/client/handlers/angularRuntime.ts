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
	styles?: string[];
	encapsulation?: number;
	template?: unknown;
	consts?: unknown;
	decls?: number;
	vars?: number;
	viewQuery?: unknown;
	contentQueries?: unknown;
	ngContentSelectors?: unknown;
	dependencies?: unknown;
	hostBindings?: unknown;
	hostVars?: number;
	hostAttrs?: unknown;
	inputs?: unknown;
	outputs?: unknown;
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

/* Style-update batch buffer.
 *
 * When a component-CSS edit triggers HMR, the rebuilt page chunk
 * re-evaluates with `__ANGULAR_HMR_STYLE_UPDATE_MODE__` set on the
 * window. Inside that mode, every `register(id, newCtor)` call from
 * the chunk's auto-registration block routes its newCtor straight
 * into `applyStyleUpdate(id, newCtor)` instead of being a no-op
 * (which is the default for already-registered IDs).
 *
 * This is the only way to reach CHILD-component classes — the page
 * chunk only `export *`s the page's own module, so a top-level
 * `Object.keys(newModule)` walk wouldn't find imported components.
 * The registration block runs once per compiled file (page + every
 * imported component), so it covers the whole subtree.
 *
 * The batch is consulted by `handleComponentStyleUpdate` after the
 * chunk import resolves: if any registration's update returned false,
 * the orchestrator falls through to a full reboot rather than leaving
 * the page partially restyled. */

type StyleUpdateMode = typeof globalThis & {
	__ANGULAR_HMR_STYLE_UPDATE_MODE__?: boolean;
};

type StyleBatchEntry = { id: string; ok: boolean };

const styleUpdateBatch: StyleBatchEntry[] = [];

const beginStyleUpdateBatch = () => {
	styleUpdateBatch.length = 0;
};

const endStyleUpdateBatch = (): StyleBatchEntry[] => {
	const out = styleUpdateBatch.slice();
	styleUpdateBatch.length = 0;

	return out;
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

		return;
	}

	// Already registered. If we're inside an HMR style-update or
	// template-update window, route this re-registration's new ctor
	// through the appropriate surgical patcher. The per-file
	// auto-registration block is the only place to intercept new ctors
	// for CHILD components — the page chunk's `export *` only re-exports
	// the page's own module.
	const styleScope = globalThis as StyleUpdateMode;
	if (styleScope.__ANGULAR_HMR_STYLE_UPDATE_MODE__) {
		const ok = applyStyleUpdate(id, ctor);
		styleUpdateBatch.push({ id, ok });

		return;
	}
	const tmplScope = globalThis as TemplateUpdateMode;
	if (tmplScope.__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__) {
		const ok = applyTemplateUpdate(id, ctor);
		templateUpdateBatch.push({ id, ok });

		return;
	}
	const svcScope = globalThis as ServiceUpdateMode;
	if (svcScope.__ANGULAR_HMR_SERVICE_UPDATE_MODE__) {
		const ok = applyServiceUpdate(id, ctor);
		serviceUpdateBatch.push({ id, ok });
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

/* Component-style HMR — swaps `ɵcmp.styles` and replaces matching
 * `<style>` tags in the document so the visible page reflects the new
 * CSS without a re-bootstrap.
 *
 * Why this is safe with Emulated encapsulation (the default): Angular's
 * compiler rewrites the CSS at build time, prefixing every selector
 * with `[_ngcontent-c<scopeId>]`. The scope ID is deterministic per
 * component def — the same source file produces the same scope ID
 * across rebuilds — so the rewritten DOM still matches the new CSS.
 * We only need to update the style *content*; the elements wearing
 * `_ngcontent-c<scopeId>` attributes are still on the page from the
 * initial bootstrap.
 *
 * ShadowDOM encapsulation (3) is not yet handled — each component
 * instance has its own shadow root with its own style tags, requiring
 * a per-instance walk. Falls through to reboot for now.
 *
 * The matching strategy: walk every `<style>` tag in `document.head`
 * and `document.body`, find ones whose `textContent` exactly matches a
 * string in the OLD `ɵcmp.styles` array, and replace it with the
 * corresponding string from the NEW array. Equal-length arrays only —
 * adding or removing a `styleUrl` entry triggers a reboot.
 *
 * Returns true on full success, false if we couldn't safely apply
 * (length mismatch, ShadowDOM, missing styles array, or any old
 * style had no DOM match — meaning we'd leave the page in a partially
 * updated state). */

const SHADOW_DOM_ENCAPSULATION = 3;

type StyleHost = {
	host: ParentNode;
	tags: HTMLStyleElement[];
};

const collectStyleHosts = (): StyleHost[] => {
	const hosts: StyleHost[] = [];
	const headTags = Array.from(
		document.head.querySelectorAll('style')
	) as HTMLStyleElement[];
	const bodyTags = Array.from(
		document.body.querySelectorAll('style')
	) as HTMLStyleElement[];
	if (headTags.length > 0) hosts.push({ host: document.head, tags: headTags });
	if (bodyTags.length > 0) hosts.push({ host: document.body, tags: bodyTags });

	return hosts;
};

const findStyleTagByContent = (
	hosts: StyleHost[],
	content: string,
	consumed: Set<HTMLStyleElement>
): HTMLStyleElement | null => {
	for (const { tags } of hosts) {
		for (const tag of tags) {
			if (consumed.has(tag)) continue;
			if (tag.textContent === content) return tag;
		}
	}

	return null;
};

const applyStyleUpdate = (id: string, newCtor: unknown) => {
	if (!isComponentCtor(newCtor)) return false;

	const entry = componentRegistry.get(id);
	if (!entry) {
		// First time we've seen this component — register it but no styles
		// to swap yet. The next edit will pick up the now-registered ctor.
		register(id, newCtor);

		return true;
	}

	const { liveCtor } = entry;
	if (liveCtor === newCtor) return true;

	const liveCmp = liveCtor.ɵcmp;
	const newCmp = newCtor.ɵcmp;
	if (!liveCmp || !newCmp) return false;

	if (
		liveCmp.encapsulation === SHADOW_DOM_ENCAPSULATION ||
		newCmp.encapsulation === SHADOW_DOM_ENCAPSULATION
	) {
		// Shadow DOM scopes styles per-instance — out of scope for v1.
		return false;
	}

	const oldStyles = liveCmp.styles;
	const nextStyles = newCmp.styles;
	if (!Array.isArray(oldStyles) || !Array.isArray(nextStyles)) return false;
	if (oldStyles.length !== nextStyles.length) return false;
	if (oldStyles.length === 0) {
		// No styles to swap, no work to do — succeed trivially.
		liveCmp.styles = nextStyles;

		return true;
	}

	const hosts = collectStyleHosts();
	const consumed = new Set<HTMLStyleElement>();
	const matches: { tag: HTMLStyleElement; nextContent: string }[] = [];

	for (let i = 0; i < oldStyles.length; i++) {
		const oldContent = oldStyles[i] ?? '';
		const nextContent = nextStyles[i] ?? '';
		if (oldContent === nextContent) continue;
		const tag = findStyleTagByContent(hosts, oldContent, consumed);
		if (!tag) {
			// Couldn't locate one of the live <style> tags — fall through
			// to reboot rather than leaving the page in a half-updated
			// state.
			return false;
		}
		consumed.add(tag);
		matches.push({ tag, nextContent });
	}

	// Only mutate after we've verified we can update every diffed style.
	for (const { tag, nextContent } of matches) {
		tag.textContent = nextContent;
	}
	liveCmp.styles = nextStyles;

	updateCounter.value++;
	entry.updateCount++;
	entry.registeredAt = Date.now();

	return true;
};

/* Template HMR — surgical swap of the template-related fields on a
 * registered component's `ɵcmp` so the live instance re-renders with
 * the new template WITHOUT re-instantiating. Inputs, outputs, host
 * bindings, providers, and lifecycle hooks live on the class
 * prototype + ɵcmp, and we leave those alone — only the template
 * factory and the slot counts/queries that depend on it are replaced.
 *
 * Why a defined list of fields and not a full `ɵcmp` swap: a wholesale
 * `Object.assign(liveCmp, newCmp)` would also overwrite `providers /
 * providersResolver` and other class-level metadata. Those changes
 * already require a full reboot (the existing fast-path handler in
 * `angular.ts` checks `hasProviderChanges` and bails). For a pure
 * template edit, restricting the patch to the template subgraph
 * keeps live instances on the same DI tokens, queryList references,
 * input bindings, etc. — only the rendered output changes.
 *
 * After the swap, the component's TView (the cached view layout) is
 * stale because slot counts may have changed. Angular regenerates the
 * TView lazily on the first re-render, but only if the existing one
 * is invalidated — which happens automatically when we walk the live
 * instances and call `applyChanges`. The same `markPatchedDirty`
 * helper used by `applyUpdate` covers OnPush views too. */

const TEMPLATE_PATCH_FIELDS = [
	'template',
	'consts',
	'decls',
	'vars',
	'viewQuery',
	'contentQueries',
	'ngContentSelectors',
	'dependencies',
	'hostBindings',
	'hostVars',
	'hostAttrs',
	'inputs',
	'outputs'
] as const;

const applyTemplateUpdate = (id: string, newCtor: unknown) => {
	if (!isComponentCtor(newCtor)) return false;

	const entry = componentRegistry.get(id);
	if (!entry) {
		register(id, newCtor);

		return true;
	}

	const { liveCtor } = entry;
	if (liveCtor === newCtor) return true;

	const liveCmp = liveCtor.ɵcmp as Record<string, unknown> | undefined;
	const nextCmp = newCtor.ɵcmp as Record<string, unknown> | undefined;
	if (!liveCmp || !nextCmp) return false;

	// If providers changed, this isn't a pure template edit anymore —
	// fall back to reboot via the caller.
	if (hasProviderChanges(liveCtor, newCtor)) return false;

	for (const field of TEMPLATE_PATCH_FIELDS) {
		if (Object.prototype.hasOwnProperty.call(nextCmp, field)) {
			liveCmp[field] = nextCmp[field];
		}
	}

	pendingFastPatchRefresh.add(liveCtor);
	updateCounter.value++;
	entry.updateCount++;
	entry.registeredAt = Date.now();

	return true;
};

type TemplateUpdateMode = typeof globalThis & {
	__ANGULAR_HMR_TEMPLATE_UPDATE_MODE__?: boolean;
};

const templateUpdateBatch: StyleBatchEntry[] = [];

const beginTemplateUpdateBatch = () => {
	templateUpdateBatch.length = 0;
};

const endTemplateUpdateBatch = (): StyleBatchEntry[] => {
	const out = templateUpdateBatch.slice();
	templateUpdateBatch.length = 0;

	return out;
};

/* Service HMR — Level 3 hybrid:
 *   1. Always swap prototype methods on the live ctor. Reaches every
 *      live instance (singletons + transient injectees) because they
 *      all share the same prototype.
 *   2. If the live singleton is reachable via the root injector,
 *      attempt to instantiate a donor with the new ctor and copy any
 *      OWN PROPERTIES that the live singleton is missing — this picks
 *      up new class-field initializers without overwriting accumulated
 *      runtime state. Donor instantiation is best-effort: services
 *      using `inject()` outside of an injection context will throw,
 *      and we just skip the field merge in that case (the prototype
 *      swap still applies, so method changes take effect).
 *   3. The classifier only routes here for services with NO
 *      side-effecting calls in the constructor / field initializers
 *      (no `subscribe / setInterval / addEventListener / effect /
 *      new Worker / new EventSource / etc.`). Anything that touches
 *      external state at construction time falls through to reboot
 *      via the server-side classification, never reaching this code
 *      path. */

type AppRefWithInjector = {
	injector?: { get?: (token: unknown, notFoundValue?: unknown) => unknown };
};

const getRootInjector = ():
	| { get: (token: unknown, notFoundValue?: unknown) => unknown }
	| null => {
	const app = window.__ANGULAR_APP__ as AppRefWithInjector | null;
	if (!app || !app.injector || typeof app.injector.get !== 'function') {
		return null;
	}

	return app.injector as {
		get: (token: unknown, notFoundValue?: unknown) => unknown;
	};
};

const swapPrototypeMethods = (
	liveCtor: ComponentCtor,
	newCtor: ComponentCtor
) => {
	const newProto = newCtor.prototype as Record<string, unknown>;
	const liveProto = liveCtor.prototype as Record<string, unknown>;
	Object.getOwnPropertyNames(newProto).forEach((prop) => {
		if (prop === 'constructor') return;
		try {
			const desc = Object.getOwnPropertyDescriptor(newProto, prop);
			if (desc) Object.defineProperty(liveProto, prop, desc);
		} catch {
			/* non-configurable property — skip */
		}
	});
};

const tryInstantiateServiceDonor = (newCtor: ComponentCtor): unknown | null => {
	try {
		// `new newCtor()` with no args. Works for services with no
		// constructor params and no `inject()` calls at field-init time.
		// Anything more sophisticated (services that use `inject()`
		// outside an injection context) throws here and we fall back to
		// prototype-only swap.
		return Reflect.construct(
			newCtor as unknown as new () => unknown,
			[]
		);
	} catch {
		return null;
	}
};

const mergeMissingFields = (
	liveInstance: Record<string, unknown>,
	donor: Record<string, unknown>
) => {
	let merged = 0;
	Object.getOwnPropertyNames(donor).forEach((prop) => {
		if (Object.prototype.hasOwnProperty.call(liveInstance, prop)) return;
		try {
			const desc = Object.getOwnPropertyDescriptor(donor, prop);
			if (desc) {
				Object.defineProperty(liveInstance, prop, desc);
				merged++;
			}
		} catch {
			/* defining the property failed — skip */
		}
	});

	return merged;
};

const applyServiceUpdate = (id: string, newCtor: unknown) => {
	if (!isComponentCtor(newCtor)) return false;

	const entry = componentRegistry.get(id);
	if (!entry) {
		register(id, newCtor);

		return true;
	}

	const { liveCtor } = entry;
	if (liveCtor === newCtor) return true;

	// Method swap — reaches every live instance.
	swapPrototypeMethods(liveCtor, newCtor);

	// Best-effort field merge on the live singleton.
	const injector = getRootInjector();
	if (injector) {
		try {
			const liveInstance = injector.get(liveCtor, null) as Record<
				string,
				unknown
			> | null;
			if (liveInstance) {
				const donor = tryInstantiateServiceDonor(newCtor) as Record<
					string,
					unknown
				> | null;
				if (donor) mergeMissingFields(liveInstance, donor);
			}
		} catch {
			/* injector lookup failed — service may not be `providedIn:
			   "root"`, or the type-token mismatched. Prototype swap is
			   already applied, so methods take effect either way. */
		}
	}

	updateCounter.value++;
	entry.updateCount++;
	entry.registeredAt = Date.now();

	return true;
};

type ServiceUpdateMode = typeof globalThis & {
	__ANGULAR_HMR_SERVICE_UPDATE_MODE__?: boolean;
};

const serviceUpdateBatch: StyleBatchEntry[] = [];

const beginServiceUpdateBatch = () => {
	serviceUpdateBatch.length = 0;
};

const endServiceUpdateBatch = (): StyleBatchEntry[] => {
	const out = serviceUpdateBatch.slice();
	serviceUpdateBatch.length = 0;

	return out;
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
		applyServiceUpdate,
		applyStyleUpdate,
		applyTemplateUpdate,
		applyUpdate,
		beginServiceUpdateBatch,
		beginStyleUpdateBatch,
		beginTemplateUpdateBatch,
		endServiceUpdateBatch,
		endStyleUpdateBatch,
		endTemplateUpdateBatch,
		getStats: getAngularHmrStats,
		hasPageExportsChanged,
		recordPageExports,
		refresh,
		register,
		getRegistry: () => componentRegistry
	};
};

installAngularHMRRuntime();
