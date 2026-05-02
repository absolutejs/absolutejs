import { type ComponentType, createElement } from 'react';
import { hydrateRoot, type Root as ReactRoot } from 'react-dom/client';

const reactIslandRoots = new WeakMap<HTMLElement, ReactRoot>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const isReactComponent = (
	value: unknown
): value is ComponentType<Record<string, unknown>> =>
	typeof value === 'function';

export const hydrateReactIsland = (
	component: ComponentType<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	const existingRoot = reactIslandRoots.get(element);
	if (existingRoot) {
		existingRoot.render(
			isPropsRecord(props)
				? createElement(component, props)
				: createElement(component)
		);

		return;
	}

	if (!isPropsRecord(props)) {
		reactIslandRoots.set(
			element,
			hydrateRoot(element, createElement(component))
		);

		return;
	}

	reactIslandRoots.set(
		element,
		hydrateRoot(element, createElement(component, props))
	);
};
