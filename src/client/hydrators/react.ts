import { type ComponentType, createElement, type ReactNode } from 'react';
import {
	createRoot,
	hydrateRoot,
	type Root as ReactRoot
} from 'react-dom/client';
import { flushSync } from 'react-dom';
import { prepareBrowserTranslationHydration } from '../browserTranslation';

const reactIslandRoots = new WeakMap<HTMLElement, ReactRoot>();
// The component each island root renders, for Fast Refresh (below).
const reactIslandComponents = new WeakMap<HTMLElement, unknown>();

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
		reactIslandComponents.set(element, component);

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
		reactIslandComponents.set(element, component);
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

/** Dev HMR: replace a hydrated island with a fresh root rendering the
 *  rebuilt component. Its local state starts over; island stores keep
 *  theirs. A new root rather than `render()` on the old one: the host page
 *  may have re-rendered the marker since, re-attaching its own React props
 *  to it, and the old root's tree would then be reconciled against nodes
 *  React no longer considers its own. */
export const remountReactIsland = (
	component: ComponentType<Record<string, unknown>>,
	element: HTMLElement,
	props: unknown
) => {
	try {
		reactIslandRoots.get(element)?.unmount();
	} catch {
		// The old tree's nodes may already be gone; the marker is cleared
		// below either way.
	}
	element.replaceChildren();
	detachFromHostReactRoot(element);
	const root = createRoot(element);
	// Commit now, while the marker carries none of the host root's
	// expandos (see detachFromHostReactRoot): a host re-render in between
	// re-attaches them and React rejects the marker as a container.
	flushSync(() => {
		root.render(
			isPropsRecord(props)
				? createElement(component, props)
				: createElement(component)
		);
	});
	reactIslandRoots.set(element, root);
	reactIslandComponents.set(element, component);
};

/* The component an island root rendered in its last commit. */
const renderedComponent = (root: ReactRoot | undefined) => {
	const fiberRoot: unknown = root && Reflect.get(root, '_internalRoot');
	const hostFiber: unknown =
		fiberRoot && typeof fiberRoot === 'object'
			? Reflect.get(fiberRoot, 'current')
			: undefined;
	const child: unknown =
		hostFiber && typeof hostFiber === 'object'
			? Reflect.get(hostFiber, 'child')
			: undefined;

	return child && typeof child === 'object'
		? Reflect.get(child, 'type')
		: undefined;
};

/** Dev HMR: hand a rebuilt island component to React Fast Refresh. In dev
 *  the island bundles register their components with Fast Refresh, so when
 *  the version on screen and the rebuilt one are the same component (one
 *  Fast Refresh family), a refresh re-renders the island in place: its hook
 *  state stays when its hooks are unchanged and resets when they changed,
 *  as on a React page. True when every given island now renders
 *  `component`; false sends the caller to remountReactIsland (no Fast
 *  Refresh runtime on the page, a component not registered, or a root
 *  the refresh did not reach). */
export const refreshReactIslands = (
	component: unknown,
	elements: HTMLElement[]
) => {
	const runtime = window.$RefreshRuntime$;
	const getFamily = runtime?.getFamilyByType;
	if (!runtime || !getFamily) return false;
	const family = getFamily(component);
	if (!family) return false;
	const sameFamily = elements.every((element) => {
		const previous = reactIslandComponents.get(element);

		return previous !== undefined && getFamily(previous) === family;
	});
	if (!sameFamily) return false;
	runtime.performReactRefresh();
	if (family.current !== component) return false;

	return elements.every((element) => {
		if (renderedComponent(reactIslandRoots.get(element)) !== component)
			return false;
		reactIslandComponents.set(element, component);

		return true;
	});
};
