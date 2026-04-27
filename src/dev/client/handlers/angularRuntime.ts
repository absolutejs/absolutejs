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

const componentRegistry = new Map<string, RegistryEntry>();
let globalUpdateCount = 0;

const hasInjectorProviderChanges = (
	oldCtor: ComponentCtor,
	newCtor: ComponentCtor
) => {
	if (oldCtor.ɵinj === undefined || newCtor.ɵinj === undefined) return false;
	const oldP = oldCtor.ɵinj?.providers;
	const newP = newCtor.ɵinj?.providers;
	if (!Array.isArray(oldP) || !Array.isArray(newP)) return false;

	return oldP.length !== newP.length;
};

const hasComponentProviderChanges = (
	oldCtor: ComponentCtor,
	newCtor: ComponentCtor
) => {
	if (!oldCtor.ɵcmp || !newCtor.ɵcmp) return false;
	const oldResolver = oldCtor.ɵcmp.providersResolver;
	const newResolver = newCtor.ɵcmp.providersResolver;

	return (oldResolver === undefined) !== (newResolver === undefined);
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

	globalUpdateCount++;
	entry.updateCount++;
	entry.registeredAt = Date.now();
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

		return true;
	} catch (err) {
		console.error('[HMR] Angular runtime patch failed for', id, ':', err);

		return false;
	}
};

const refresh = () => {
	if (!window.__ANGULAR_APP__) return;
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
		return globalUpdateCount;
	}
};

const getAngularHmrStats = () => angularHmrStats;

export const installAngularHMRRuntime = () => {
	if (typeof window === 'undefined') return;
	window.__ANGULAR_HMR__ = {
		applyUpdate,
		getStats: getAngularHmrStats,
		refresh,
		register,
		getRegistry: () => componentRegistry
	};
};

installAngularHMRRuntime();
