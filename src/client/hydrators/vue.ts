import { createApp, createSSRApp, h, type App as VueApp } from 'vue';

const vueIslandApps = new WeakMap<HTMLElement, VueApp>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

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
};
