/* A component-scoped async value: `useResource` in React and Svelte
 * (client/resource.ts). Vue's has refs for the same three fields and
 * its own types beside it. */

/** Loads the value. `signal` aborts when the component goes away or a
 *  newer load starts; hand it to `fetch`. */
export type ResourceFetcher<Value> = (signal: AbortSignal) => Promise<Value>;

/** When the first load happens.
 *
 *  - `'immediate'` (the default): when the component mounts in the
 *    browser. `loading` starts `true`.
 *  - `'pending'`: not until `refresh()` is called, and `loading` starts
 *    `true` all the same, for a load that waits on something the
 *    component learns after it mounts.
 *  - `'idle'`: not until `refresh()` or `mutate()`, and `loading`
 *    starts `false`. */
export type ResourceStart = 'idle' | 'immediate' | 'pending';

export type ResourceOptions = {
	/** When the first load happens. Default `'immediate'`. */
	start?: ResourceStart;
};

/** A new value, or a function of the current one. */
export type ResourceMutator<Value> =
	Value | null | ((previous: Value | null) => Value | null);

/** What a resource holds at a moment. */
export type ResourceState<Value> = {
	/** The latest value loaded, or `null` before the first. */
	data: Value | null;
	/** Why the latest load failed, or `null`. */
	error: unknown;
	/** Whether a load is in flight, or is about to be (`'pending'`). */
	loading: boolean;
};

/** What every resource can be told to do. */
export type ResourceActions<Value> = {
	/** Stops the load in flight, if there is one. */
	cancel: () => void;
	/** Sets the value without loading it, after an edit returned the new
	 *  one. A load in flight is stopped, so a slower answer cannot
	 *  overwrite it. */
	mutate: (next: ResourceMutator<Value>) => void;
	/** Loads again. A load in flight is stopped first. */
	refresh: () => Promise<void>;
};
