/* Angular HMR Runtime Layer (Level 3)
   Runtime component patching that avoids destroy + bootstrap.
   Swaps component implementations in-place via prototype replacement
   and Angular internal metadata patching (ɵcmp, ɵfac).

   DEV MODE ONLY — this module is never included in production builds. */

// Angular HMR Runtime Layer (Level 3) — Component constructor type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComponentCtor = any;

// Angular HMR Runtime Layer (Level 3) — Component registry entry
interface RegistryEntry {
    /** The ORIGINAL constructor that Angular bootstrapped with.
     *  This is the live reference — all existing component instances
     *  have their __proto__ pointing at this constructor's prototype.
     *  We ALWAYS swap onto this; we NEVER replace it. */
    liveCtor: ComponentCtor;
    id: string;
    registeredAt: number;
    updateCount: number;
}

// Angular HMR Runtime Layer (Level 3) — Component registry
const componentRegistry = new Map<string, RegistryEntry>();

// Angular HMR Runtime Layer (Level 3) — Track global update count for debugging
let globalUpdateCount = 0;

/** Check if a constructor has Angular injectable metadata */
const hasProviderChanges = (
    oldCtor: ComponentCtor,
    newCtor: ComponentCtor
): boolean => {
    // Angular HMR Runtime Layer (Level 3) — HMR boundary detection
    // If NgModule injector metadata changed, we can't safely hot-patch
    if (oldCtor.ɵinj !== undefined && newCtor.ɵinj !== undefined) {
        const oldProviders = oldCtor.ɵinj?.providers;
        const newProviders = newCtor.ɵinj?.providers;
        if (oldProviders && newProviders) {
            if (
                Array.isArray(oldProviders) &&
                Array.isArray(newProviders) &&
                oldProviders.length !== newProviders.length
            ) {
                return true;
            }
        }
    }

    // Check if component-level providers changed
    if (oldCtor.ɵcmp && newCtor.ɵcmp) {
        const oldCompProviders = oldCtor.ɵcmp.providersResolver;
        const newCompProviders = newCtor.ɵcmp.providersResolver;
        if (
            (oldCompProviders === undefined) !== (newCompProviders === undefined)
        ) {
            return true;
        }
    }

    return false;
};

/** Angular HMR Runtime Layer (Level 3) — Register a component constructor.
 *  IMPORTANT: Only stores the constructor on FIRST call. Subsequent calls
 *  are no-ops — the registry keeps the original "live" constructor that
 *  Angular bootstrapped with. applyUpdate() swaps onto this live reference. */
const register = (id: string, ctor: ComponentCtor): void => {
    if (!id || typeof ctor !== 'function') return;

    // Only store on first registration — this is the constructor Angular
    // actually used for bootstrapApplication(). All existing component
    // instances reference this constructor's prototype.
    if (!componentRegistry.has(id)) {
        componentRegistry.set(id, {
            liveCtor: ctor,
            id,
            registeredAt: Date.now(),
            updateCount: 0
        });
    }
    // On subsequent calls (re-imports), do nothing.
    // The new constructor will be passed to applyUpdate() separately.
};

/** Angular HMR Runtime Layer (Level 3) — Apply a component update via prototype swap.
 *  Swaps methods and Angular metadata from newCtor onto the LIVE (original) constructor.
 *  Returns true if patch succeeded, false if full reload needed. */
const applyUpdate = (id: string, newCtor: ComponentCtor): boolean => {
    const entry = componentRegistry.get(id);

    if (!entry) {
        // First time seeing this component — just register it
        register(id, newCtor);
        return true;
    }

    const liveCtor = entry.liveCtor;

    // Same constructor reference — nothing to patch (initial load)
    if (liveCtor === newCtor) {
        return true;
    }

    // Angular HMR Runtime Layer (Level 3) — HMR boundary check
    if (hasProviderChanges(liveCtor, newCtor)) {
        console.warn(
            '[HMR] Angular provider/injector change detected for',
            id,
            '— falling back to full reload'
        );
        return false;
    }

    // New constructor must be a valid Angular component
    if (newCtor.ɵcmp === undefined && liveCtor.ɵcmp !== undefined) {
        console.warn(
            '[HMR] New constructor missing ɵcmp for',
            id,
            '— falling back to full reload'
        );
        return false;
    }

    try {
        // Angular HMR Runtime Layer (Level 3) — Swap prototype methods
        // Existing component instances have __proto__ === liveCtor.prototype,
        // so modifying liveCtor.prototype immediately affects all instances.
        const newProto = newCtor.prototype;

        const newPropNames = Object.getOwnPropertyNames(newProto);
        for (const propName of newPropNames) {
            if (propName === 'constructor') continue;
            try {
                const descriptor = Object.getOwnPropertyDescriptor(
                    newProto,
                    propName
                );
                if (descriptor) {
                    Object.defineProperty(liveCtor.prototype, propName, descriptor);
                }
            } catch (_e) {
                // Some properties may not be configurable — skip them
            }
        }

        // Angular HMR Runtime Layer (Level 3) — Swap Angular internal metadata
        if (newCtor.ɵcmp) {
            // Template function — the key for visual updates
            if (newCtor.ɵcmp.template) {
                liveCtor.ɵcmp.template = newCtor.ɵcmp.template;
            }
            // Structural directives referenced in template
            if (newCtor.ɵcmp.directiveDefs !== undefined) {
                liveCtor.ɵcmp.directiveDefs = newCtor.ɵcmp.directiveDefs;
            }
            // Pipes referenced in template
            if (newCtor.ɵcmp.pipeDefs !== undefined) {
                liveCtor.ɵcmp.pipeDefs = newCtor.ɵcmp.pipeDefs;
            }
            // Component styles
            if (newCtor.ɵcmp.styles !== undefined) {
                liveCtor.ɵcmp.styles = newCtor.ɵcmp.styles;
            }
            // Content queries (@ContentChild, @ContentChildren)
            if (newCtor.ɵcmp.contentQueries !== undefined) {
                liveCtor.ɵcmp.contentQueries = newCtor.ɵcmp.contentQueries;
            }
            // View queries (@ViewChild, @ViewChildren)
            if (newCtor.ɵcmp.viewQuery !== undefined) {
                liveCtor.ɵcmp.viewQuery = newCtor.ɵcmp.viewQuery;
            }
            // Host bindings
            if (newCtor.ɵcmp.hostBindings !== undefined) {
                liveCtor.ɵcmp.hostBindings = newCtor.ɵcmp.hostBindings;
            }
            // Inputs/outputs
            if (newCtor.ɵcmp.inputs !== undefined) {
                liveCtor.ɵcmp.inputs = newCtor.ɵcmp.inputs;
            }
            if (newCtor.ɵcmp.outputs !== undefined) {
                liveCtor.ɵcmp.outputs = newCtor.ɵcmp.outputs;
            }
            // Declarations (standalone component imports)
            if (newCtor.ɵcmp.dependencies !== undefined) {
                liveCtor.ɵcmp.dependencies = newCtor.ɵcmp.dependencies;
            }
            // Feature functions
            if (newCtor.ɵcmp.features !== undefined) {
                liveCtor.ɵcmp.features = newCtor.ɵcmp.features;
            }
        }

        // Factory function for creating new instances
        if (newCtor.ɵfac) {
            liveCtor.ɵfac = newCtor.ɵfac;
        }

        // Swap configurable static properties
        const staticProps = Object.getOwnPropertyNames(newCtor);
        for (const prop of staticProps) {
            if (
                prop === 'prototype' ||
                prop === 'length' ||
                prop === 'name' ||
                prop === 'caller' ||
                prop === 'arguments'
            ) {
                continue;
            }
            try {
                const descriptor = Object.getOwnPropertyDescriptor(
                    newCtor,
                    prop
                );
                if (descriptor && descriptor.configurable) {
                    Object.defineProperty(liveCtor, prop, descriptor);
                }
            } catch (_e) {
                // Skip non-configurable static properties
            }
        }

        globalUpdateCount++;
        entry.updateCount++;
        entry.registeredAt = Date.now();

        return true;
    } catch (err) {
        console.error(
            '[HMR] Angular runtime patch failed for',
            id,
            ':',
            err
        );
        return false;
    }
};

/** Angular HMR Runtime Layer (Level 3) — Trigger change detection after patch */
const refresh = (): void => {
    if (window.__ANGULAR_APP__) {
        try {
            window.__ANGULAR_APP__.tick();
        } catch (err) {
            console.warn('[HMR] Angular tick() failed after patch:', err);
        }
    }
};

/** Angular HMR Runtime Layer (Level 3) — Get registry stats for debugging */
const getStats = (): { componentCount: number; updateCount: number } => {
    return {
        componentCount: componentRegistry.size,
        updateCount: globalUpdateCount
    };
};

// Angular HMR Runtime Layer (Level 3) — Install global HMR API
export const installAngularHMRRuntime = (): void => {
    if (typeof window === 'undefined') return;

    window.__ANGULAR_HMR__ = {
        register,
        applyUpdate,
        refresh,
        getStats
    };
};

// Angular HMR Runtime Layer (Level 3) — Auto-install on import
installAngularHMRRuntime();
