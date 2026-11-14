import { hydrate as hydrateSvelte, mount, unmount } from 'svelte';

const svelteIslandInstances = new WeakMap<
	HTMLElement,
	Record<string, unknown>
>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const hydrateSvelteIsland = (
	component: import('svelte').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	const instance = hydrateSvelte(component, {
		props: isPropsRecord(props) ? props : undefined,
		target: element
	});
	svelteIslandInstances.set(element, instance);
};

export const isSvelteComponent = (
	value: unknown
): value is import('svelte').Component<Record<string, unknown>> =>
	typeof value === 'function';

/** Dev HMR: replace a hydrated island with a fresh mount of the rebuilt
 *  component. Its local state starts over; island stores keep theirs. */
export const remountSvelteIsland = async (
	component: import('svelte').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	const instance = svelteIslandInstances.get(element);
	if (instance) await unmount(instance);
	element.replaceChildren();
	svelteIslandInstances.set(
		element,
		mount(component, {
			props: isPropsRecord(props) ? props : undefined,
			target: element
		})
	);
};
