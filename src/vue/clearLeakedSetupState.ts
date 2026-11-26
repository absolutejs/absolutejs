/* Vue leaves its "a component is being set up / rendered" state set when
 * a component throws during a server render. There are two of them, and
 * `getCurrentInstance()` reads both:
 *
 * - the CURRENT instance, when `setup()` throws. `setupStatefulComponent`
 *   marks the instance, calls `setup`, and unmarks it afterwards, with
 *   no `finally`. The instance's effect scope stays active the same way.
 * - the RENDERING instance, when a render function throws.
 *   `renderComponentRoot` catches the error to hand it to the app's
 *   error handler, which on the server rethrows, past the line that
 *   restores the previous one.
 *
 * Nothing ever resets either: `getCurrentInstance()` returns the dead
 * component for the rest of the process, a later successful render
 * included (each one restores the "previous" instance, which is the
 * leaked one).
 *
 * So every guard that asks "am I inside setup()?" answers yes forever
 * after one failed render. `useServerData` called from a plain function
 * stopped reporting the misuse and registered its prefetch on the dead
 * component, where it never ran.
 *
 * The reset uses what Vue itself keeps for this state. For the current
 * instance, `__VUE_INSTANCE_SETTERS__` and `__VUE_SSR_SETTERS__`: arrays
 * of setters on `globalThis`, one per loaded copy of the runtime, which
 * Vue calls so that separately bundled copies agree. For the rendering
 * instance, `ssrUtils.setCurrentRenderingInstance`. None of it is
 * documented API, so each step is checked and does nothing when the
 * shape is not what is expected — the worst case is the leak Vue
 * already had.
 *
 * Call it only once a render has FAILED, from the code handling the
 * rejection. The clearing itself is synchronous and runs in a task of
 * its own, when no setup can be in flight.
 * Clearing before a render would break one legitimately started from
 * inside another component's setup. */

const INSTANCE_SETTERS = '__VUE_INSTANCE_SETTERS__';
const SSR_SETUP_SETTERS = '__VUE_SSR_SETTERS__';

const callEach = (registry: string, value: false | null) => {
	const setters: unknown = Reflect.get(globalThis, registry);
	if (!Array.isArray(setters)) return;
	setters.forEach((setter: unknown) => {
		if (typeof setter === 'function') setter(value);
	});
};

export const clearingSetupStateOnFailure = async <T>(render: Promise<T>) => {
	try {
		return await render;
	} catch (error) {
		await clearLeakedVueSetupState();
		throw error;
	}
};
/* Vue is imported here, on use, and never at the top of the file: the
 * page handler that calls this is part of every server bundle, and a
 * static import would make an app with no Vue pages fail to start for
 * want of a package it does not use. */
const loadVue = async () => {
	try {
		return await import('vue');
	} catch {
		return null;
	}
};

export const clearLeakedVueSetupState = async () => {
	const vue = await loadVue();
	if (vue === null) return false;
	const leaked: unknown = vue.getCurrentInstance();
	if (leaked === null) return false;

	// What Vue's own unset does first: deactivate the instance's effect
	// scope, or `getCurrentScope()` keeps returning it.
	const scope: unknown =
		typeof leaked === 'object' ? Reflect.get(leaked, 'scope') : undefined;
	const off: unknown =
		typeof scope === 'object' && scope !== null
			? Reflect.get(scope, 'off')
			: undefined;
	if (typeof off === 'function') off.call(scope);

	callEach(INSTANCE_SETTERS, null);
	callEach(SSR_SETUP_SETTERS, false);

	// The rendering instance has an exported setter, on the object Vue
	// hands its own server renderer: `ssrUtils`, exported at run time
	// and left out of the type declarations, hence the namespace read.
	const ssrUtils: unknown = Reflect.get(vue, 'ssrUtils');
	const setRendering: unknown =
		typeof ssrUtils === 'object' && ssrUtils !== null
			? Reflect.get(ssrUtils, 'setCurrentRenderingInstance')
			: undefined;
	if (typeof setRendering === 'function') setRendering(null);

	return true;
};
