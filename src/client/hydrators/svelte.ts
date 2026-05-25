import { hydrate as hydrateSvelte } from 'svelte';

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const hydrateSvelteIsland = (
	component: import('svelte').Component<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	hydrateSvelte(component, {
		props: isPropsRecord(props) ? props : undefined,
		target: element
	});
};
export const isSvelteComponent = (
	value: unknown
): value is import('svelte').Component<Record<string, unknown>> =>
	typeof value === 'function';
