import { createApp, createSSRApp, h, type App as VueApp } from 'vue';
import { registerIslandDisposer } from '../islandDisposers';

const vueIslandApps = new WeakMap<HTMLElement, VueApp>();
// The component each island app renders, for hot updates (below).
const vueIslandComponents = new WeakMap<HTMLElement, object>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/* So a soft navigation can unmount this app with the body it lives in
 * (client/islandDisposers.ts). */
const registerAppDisposer = (element: HTMLElement, app: VueApp) => {
	registerIslandDisposer(element, () => {
		vueIslandApps.delete(element);
		vueIslandComponents.delete(element);
		app.unmount();
	});
};

export const hydrateVueIsland = (
	component: import('vue').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	if (vueIslandApps.has(element)) {
		return;
	}

	const app = createSSRApp({
		render: () => h(component, isPropsRecord(props) ? props : undefined)
	});
	app.mount(element);
	vueIslandApps.set(element, app);
	registerAppDisposer(element, app);
	if (isPropsRecord(component)) vueIslandComponents.set(element, component);
};
export const isVueComponent = (
	value: unknown
): value is import('vue').Component<Record<string, unknown>> =>
	typeof value === 'function' || isPropsRecord(value);

/** Dev HMR: replace a hydrated island with a fresh mount of the rebuilt
 *  component. Its local state starts over; island stores keep theirs. */
export const remountVueIsland = (
	component: import('vue').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	vueIslandApps.get(element)?.unmount();
	element.replaceChildren();
	const app = createApp({
		render: () => h(component, isPropsRecord(props) ? props : undefined)
	});
	app.mount(element);
	vueIslandApps.set(element, app);
	registerAppDisposer(element, app);
	if (isPropsRecord(component)) vueIslandComponents.set(element, component);
};

// Component options nest shallowly (props, emits, components).
const MAX_OPTION_DEPTH = 4;
const NON_RENDER_KEYS = new Set(['__file', '__hmrId', 'render', 'ssrRender']);

/* Whether two compiled versions of a component differ in more than their
 * render function: the same options, setup and script code. Functions
 * compare by source. */
const sameOption = (left: unknown, right: unknown, depth = 0): boolean => {
	if (left === right) return true;
	if (typeof left === 'function' && typeof right === 'function')
		return left.toString() === right.toString();
	if (
		!isPropsRecord(left) ||
		!isPropsRecord(right) ||
		depth > MAX_OPTION_DEPTH
	)
		return false;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

	return [...keys].every((key) =>
		sameOption(left[key], right[key], depth + 1)
	);
};

const onlyRenderChanged = (
	previous: Record<string, unknown>,
	next: Record<string, unknown>
) => {
	const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

	return [...keys]
		.filter((key) => !NON_RENDER_KEYS.has(key))
		.every((key) => sameOption(previous[key], next[key]));
};

/** Dev HMR through Vue's own HMR runtime, after the rebuilt island bundle
 *  has been imported. Every component of the bundle that changed (the
 *  island's own component and any it renders) is updated in place: one
 *  whose script is unchanged (a template or style edit) re-renders and
 *  keeps its state; one whose script changed reloads and starts its state
 *  over, as Vue's HMR does on a page. False when the runtime, the HMR id or
 *  the island's current component is missing: the caller re-mounts. */
export const hotUpdateVueIslands = (
	before: Record<string, unknown>,
	component: unknown,
	elements: HTMLElement[]
) => {
	const runtime = window.__VUE_HMR_RUNTIME__;
	const after = window.__VUE_HMR_COMPONENTS__;
	if (!runtime || !after || !isPropsRecord(component)) return false;
	const id = component.__hmrId;
	if (typeof id !== 'string') return false;
	const rendersIsland = elements.every((element) => {
		const previous = vueIslandComponents.get(element);

		return isPropsRecord(previous) && previous.__hmrId === id;
	});
	if (!rendersIsland) return false;
	for (const [componentId, next] of Object.entries(after)) {
		const previous = before[componentId];
		if (previous === next) continue;
		if (!isPropsRecord(previous) || !isPropsRecord(next)) continue;
		if (onlyRenderChanged(previous, next))
			runtime.rerender(componentId, next.render);
		else runtime.reload(componentId, next);
	}

	return true;
};

/** Dev HMR: the Vue components the page has loaded, by HMR id. Island
 *  bundles are compiled with Vue's HMR ids, and evaluating one records
 *  each of its components in `window.__VUE_HMR_COMPONENTS__`, replacing
 *  the previous version; take this before importing a rebuilt island. */
export const snapshotVueHmrComponents = (): Record<string, unknown> => ({
	...window.__VUE_HMR_COMPONENTS__
});
