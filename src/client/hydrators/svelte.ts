import { hydrate as hydrateSvelte, mount, unmount } from 'svelte';
import { registerIslandDisposer } from '../islandDisposers';

const svelteIslandInstances = new WeakMap<
	HTMLElement,
	Record<string, unknown>
>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/* So a soft navigation can unmount this instance with the body it lives in
 * (client/islandDisposers.ts). Svelte's `unmount` is async, which is why
 * the registry awaits its disposers. */
const registerInstanceDisposer = (
	element: HTMLElement,
	instance: Record<string, unknown>
) => {
	registerIslandDisposer(element, async () => {
		svelteIslandInstances.delete(element);
		await unmount(instance);
	});
};

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
	registerInstanceDisposer(element, instance);
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
	const next = mount(component, {
		props: isPropsRecord(props) ? props : undefined,
		target: element
	});
	svelteIslandInstances.set(element, next);
	registerInstanceDisposer(element, next);
};
