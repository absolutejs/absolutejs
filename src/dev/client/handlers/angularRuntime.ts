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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComponentCtor = any;

// Angular HMR — Zoneless Runtime Preservation: Component registry entry
interface RegistryEntry {
    /** The ORIGINAL constructor that Angular bootstrapped with.
     *  Existing component instances have __proto__ pointing here.
     *  We swap onto this; we never replace it. */
    liveCtor: ComponentCtor;
    id: string;
    registeredAt: number;
    updateCount: number;
}

// Angular HMR — Zoneless Runtime Preservation: Component registry
const componentRegistry = new Map<string, RegistryEntry>();
let globalUpdateCount = 0;

// Angular HMR — Zoneless Runtime Preservation: HMR boundary detection
// Returns true if providers / injector metadata changed (unsafe to hot-patch)
const hasProviderChanges = (
    oldCtor: ComponentCtor,
    newCtor: ComponentCtor
): boolean => {
    // NgModule injector metadata
    if (oldCtor.ɵinj !== undefined && newCtor.ɵinj !== undefined) {
        const oldP = oldCtor.ɵinj?.providers;
        const newP = newCtor.ɵinj?.providers;
        if (
            Array.isArray(oldP) &&
            Array.isArray(newP) &&
            oldP.length !== newP.length
        ) {
            return true;
        }
    }

    // Component-level providers
    if (oldCtor.ɵcmp && newCtor.ɵcmp) {
        const a = oldCtor.ɵcmp.providersResolver;
        const b = newCtor.ɵcmp.providersResolver;
        if ((a === undefined) !== (b === undefined)) return true;
    }

    return false;
};

/** Angular HMR — Zoneless Runtime Preservation: Register component.
 *  Only stores on FIRST call — keeps the live constructor Angular bootstrapped with. */
const register = (id: string, ctor: ComponentCtor): void => {
    if (!id || typeof ctor !== 'function') return;
    if (!componentRegistry.has(id)) {
        componentRegistry.set(id, {
            liveCtor: ctor,
            id,
            registeredAt: Date.now(),
            updateCount: 0
        });
    }
};

/** Angular HMR — Zoneless Runtime Preservation: Swap prototype + ɵcmp metadata.
 *  Runtime state persists by prototype swap (no serialization).
 *  Returns true on success, false if full reload required. */
const applyUpdate = (id: string, newCtor: ComponentCtor): boolean => {
    const entry = componentRegistry.get(id);
    if (!entry) {
        register(id, newCtor);
        return true;
    }

    const liveCtor = entry.liveCtor;
    if (liveCtor === newCtor) return true;

    // Angular HMR — Zoneless Runtime Preservation: safety boundary
    if (hasProviderChanges(liveCtor, newCtor)) {
        console.warn('[HMR] Angular provider change detected for', id, '→ full reload');
        return false;
    }
    if (newCtor.ɵcmp === undefined && liveCtor.ɵcmp !== undefined) {
        console.warn('[HMR] New constructor missing ɵcmp for', id, '→ full reload');
        return false;
    }

    try {
        // Angular HMR — Zoneless Runtime Preservation: swap prototype methods
        const newProto = newCtor.prototype;
        for (const prop of Object.getOwnPropertyNames(newProto)) {
            if (prop === 'constructor') continue;
            try {
                const desc = Object.getOwnPropertyDescriptor(newProto, prop);
                if (desc) Object.defineProperty(liveCtor.prototype, prop, desc);
            } catch (_e) { /* non-configurable */ }
        }

        // Angular HMR — Zoneless Runtime Preservation: swap ɵcmp metadata
        if (newCtor.ɵcmp) {
            liveCtor.ɵcmp = newCtor.ɵcmp;
        }

        // Angular HMR — Zoneless Runtime Preservation: swap ɵfac
        if (newCtor.ɵfac) {
            liveCtor.ɵfac = newCtor.ɵfac;
        }

        // Swap configurable static properties
        for (const prop of Object.getOwnPropertyNames(newCtor)) {
            if (['prototype', 'length', 'name', 'caller', 'arguments'].includes(prop)) continue;
            try {
                const desc = Object.getOwnPropertyDescriptor(newCtor, prop);
                if (desc?.configurable) Object.defineProperty(liveCtor, prop, desc);
            } catch (_e) { /* skip */ }
        }

        globalUpdateCount++;
        entry.updateCount++;
        entry.registeredAt = Date.now();
        return true;
    } catch (err) {
        console.error('[HMR] Angular runtime patch failed for', id, ':', err);
        return false;
    }
};

/** Angular HMR — Zoneless Runtime Preservation: trigger change detection.
 *  Zoneless Angular will NOT auto-detect changes — explicit tick() required. */
const refresh = (): void => {
    // Angular HMR — Zoneless Runtime Preservation: manual tick() required
    if (window.__ANGULAR_APP__) {
        try {
            window.__ANGULAR_APP__.tick();
        } catch (err) {
            console.warn('[HMR] Angular tick() failed after patch:', err);
        }
    }
};

/** Angular HMR — Zoneless Runtime Preservation: debug stats */
const getStats = (): { componentCount: number; updateCount: number } => ({
    componentCount: componentRegistry.size,
    updateCount: globalUpdateCount
});

// Angular HMR — Zoneless Runtime Preservation: install global API
export const installAngularHMRRuntime = (): void => {
    if (typeof window === 'undefined') return;
    window.__ANGULAR_HMR__ = { register, applyUpdate, refresh, getStats };
};

// Angular HMR — Zoneless Runtime Preservation: auto-install on import
installAngularHMRRuntime();
