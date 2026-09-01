import { type ComponentType, createElement, type ReactNode } from 'react';
import { hydrateRoot, type Root as ReactRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { prepareBrowserTranslationHydration } from '../browserTranslation';

const reactIslandRoots = new WeakMap<HTMLElement, ReactRoot>();

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

// The island marker is rendered by the host page's React tree as a
// `dangerouslySetInnerHTML` boundary, so the host root tags it with internal
// fiber expandos (`__reactFiber$…`, `__reactProps$…`). React refuses to create
// a second root on a node it already manages that also sets
// dangerouslySetInnerHTML ("Cannot use a ref … as a container … if that element
// also sets dangerouslySetInnerHTML"). Detaching those expandos hands ownership
// of the marker (and its opaque SSR children) to the island root before it
// hydrates. The host root never recurses into the boundary, so it has no fibers
// for the children and won't reconcile this subtree again.
const HOST_REACT_EXPANDO_PREFIXES = [
	'__reactFiber$',
	'__reactProps$',
	'__reactContainer$',
	'__reactEvents$',
	'__reactListeners$',
	'__reactHandles$'
];

const detachFromHostReactRoot = (element: HTMLElement) => {
	for (const key of Object.keys(element)) {
		const isHostExpando = HOST_REACT_EXPANDO_PREFIXES.some((prefix) =>
			key.startsWith(prefix)
		);
		if (!isHostExpando) continue;
		Reflect.deleteProperty(element, key);
	}
};

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

	detachFromHostReactRoot(element);
	const restoreTranslation = prepareBrowserTranslationHydration(element);
	const hydrate = (elementToHydrate: ReactNode) => {
		let root: ReactRoot | undefined;
		const startHydration = () => {
			root = hydrateRoot(element, elementToHydrate);
		};
		try {
			if (restoreTranslation.hasTranslation) flushSync(startHydration);
			else startHydration();
		} finally {
			restoreTranslation();
		}
		if (root !== undefined) reactIslandRoots.set(element, root);
	};

	if (!isPropsRecord(props)) {
		hydrate(createElement(component));

		return;
	}

	hydrate(createElement(component, props));
};
export const isReactComponent = (
	value: unknown
): value is ComponentType<Record<string, unknown>> =>
	typeof value === 'function';
