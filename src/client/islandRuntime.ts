import type { IslandFramework } from '../../types/island';
import { getIslandComponent, parseIslandProps } from '../core/islands';
import {
	getIslandStyleManifestKey,
	REACT_PAGE_ROOT_EVENT
} from '../core/islandManifest';
import { readIslandStyleNonce } from '../core/islandStylesheet';
import { initializeIslandMarkupSnapshot } from './preserveIslandMarkup';
import { prepareBrowserTranslationHydration } from './browserTranslation';

initializeIslandMarkupSnapshot();

type RuntimeIslandRegistry = Partial<
	Record<IslandFramework, Record<string, unknown>>
>;

type StartIslandsOptions = {
	registry: RuntimeIslandRegistry;
	resolveComponent?: (
		framework: IslandFramework,
		component: string
	) => Promise<unknown>;
	root?: ParentNode & Node;
};

type IslandElement = HTMLElement & {
	dataset: DOMStringMap & {
		component?: string;
		error?: string;
		framework?: IslandFramework;
		hydrate?: string;
		islandId?: string;
		props?: string;
	};
};

const idleDeadline: IdleDeadline = {
	didTimeout: false,
	timeRemaining: () => 0
};

const requestIdle =
	typeof window !== 'undefined' && 'requestIdleCallback' in window
		? window.requestIdleCallback.bind(window)
		: (callback: IdleRequestCallback) =>
				window.setTimeout(() => callback(idleDeadline), 1);

const isPropsRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isIslandElement = (value: EventTarget | null): value is IslandElement =>
	value instanceof HTMLElement && value.dataset.island === 'true';

const observedRoots = new WeakSet<Node>();
const hydratingIslands = new WeakSet<HTMLElement>();

const ISLAND_FRAMEWORKS: readonly IslandFramework[] = [
	'react',
	'svelte',
	'vue',
	'angular'
];

const toIslandFramework = (value: string | undefined) =>
	ISLAND_FRAMEWORKS.find((framework) => framework === value);

const readInjectedManifest = () => {
	const manifest: unknown = Reflect.get(window, '__ABSOLUTE_MANIFEST__');

	return typeof manifest === 'object' && manifest !== null
		? manifest
		: undefined;
};

const findIslandStyleLinks = (key: string) =>
	Array.from(
		document.querySelectorAll<HTMLLinkElement>(
			'link[rel="stylesheet"][data-island-style]'
		)
	).filter((link) => link.dataset.islandStyle === key);

const hasStylesheet = (href: string) => {
	const target = new URL(href, document.baseURI).href;

	return Array.from(
		document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
	).some((link) => link.href === target);
};

const createIslandStyleLink = (key: string, href: string) => {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	link.dataset.islandStyle = key;
	const nonce = readIslandStyleNonce();
	if (nonce) link.nonce = nonce;

	return link;
};

/* The server links the stylesheet of every island a page renders: in the
 * head of a whole document, next to the island on a streamed page (see
 * core/islandPageContext.ts). An island that arrives some other way (an
 * HTMX swap, a client-rendered fragment) links its own before it mounts:
 * a stylesheet, never an inline <style> a nonce-based CSP would block. */
const ensureIslandStylesheet = (framework: string, component: string) => {
	const islandFramework = toIslandFramework(framework);
	const manifest = readInjectedManifest();
	if (!islandFramework || !manifest) return;

	const key = getIslandStyleManifestKey(islandFramework, component);
	const href: unknown = Reflect.get(manifest, key);
	if (typeof href !== 'string' || hasStylesheet(href)) return;

	document.head.appendChild(createIslandStyleLink(key, href));
};

/* Dev HMR: point an island's stylesheet at its rebuilt file, wherever the
 * server put the link (the head, or next to the island on a streamed
 * page). The new link goes in right after the old one, keeping its place
 * in the cascade and its attributes (React's data-precedence), and the old
 * one leaves once the new one loads, so the island never shows unstyled. */
const swapIslandStylesheet = (
	framework: string,
	component: string,
	href: string
) => {
	const islandFramework = toIslandFramework(framework);
	if (!islandFramework || hasStylesheet(href)) return;

	const key = getIslandStyleManifestKey(islandFramework, component);
	const previous = findIslandStyleLinks(key);
	const anchor = previous[previous.length - 1];
	const next = createIslandStyleLink(key, href);
	if (anchor) {
		for (const { name, value } of Array.from(anchor.attributes))
			if (name !== 'href' && name !== 'nonce')
				next.setAttribute(name, value);
		anchor.after(next);
	} else document.head.appendChild(next);
	const removePrevious = () => {
		for (const link of previous) link.remove();
	};
	next.addEventListener('load', removePrevious, { once: true });
	next.addEventListener('error', removePrevious, { once: true });
	const manifest = readInjectedManifest();
	if (manifest) Reflect.set(manifest, key, href);
};

const hydratePreservingBrowserTranslation = async (
	element: HTMLElement,
	hydrate: () => unknown | Promise<unknown>
) => {
	const restoreTranslation = prepareBrowserTranslationHydration(element);
	try {
		await hydrate();
	} finally {
		restoreTranslation();
	}
};

// Framework-specific hydrators are dynamic-imported on first use so the
// island runtime never statically pulls in a framework's runtime (and its
// transitive deps) the consumer doesn't actually use. Without this, a
// React-only project loading `@absolutejs/absolute/client` would resolve
// every framework's peer deps — including `@angular/core` — and fail at
// module load if any of them weren't installed.
/* An island whose component does not resolve used to return silently —
 * no throw, no log, no `data-error`. The element kept its server markup
 * and simply never came alive, which is indistinguishable from "the
 * runtime never ran" and left every island problem undiagnosable; it cost
 * eight blind runs to bisect a static-page island that turned out to be
 * several separate faults.
 *
 * Thrown rather than logged here, so it goes through the same path as any
 * other hydration failure: `hydrateIsland` catches it, writes the message
 * to `data-error` on the element and logs it with the framework and
 * component name. */
const unresolvedIslandError = (resolved: unknown) =>
	new Error(
		`its component did not resolve (${
			resolved === undefined || resolved === null
				? String(resolved)
				: `got ${typeof resolved}`
		}). Check that it is in the island registry, that its island bundle loaded, and that its framework directory is configured so the build compiles it.`
	);

const hydrateByFramework = async (
	registry: RuntimeIslandRegistry,
	framework: IslandFramework,
	componentName: string,
	element: IslandElement,
	props: unknown,
	resolveComponent?: (
		framework: IslandFramework,
		component: string
	) => Promise<unknown>
) => {
	const propsRecord = isPropsRecord(props) ? props : undefined;

	if (framework === 'react') {
		const { hydrateReactIsland, isReactComponent } =
			await import('./hydrators/react');
		/* `getIslandComponent` unwraps an island component DEFINITION —
		 * what `defineIslandComponent` produces, `{ component, source }`.
		 * It has to run on the resolver's result too, not only on the
		 * registry lookup: a resolved island entry whose default export is
		 * a definition is an object, every `is…Component` guard rejects an
		 * object, and the island then failed to hydrate. */
		const resolvedComponent = getIslandComponent(
			(await resolveComponent?.(framework, componentName)) ??
				registry.react?.[componentName]
		);
		if (!isReactComponent(resolvedComponent))
			throw unresolvedIslandError(resolvedComponent);

		hydrateReactIsland(resolvedComponent, element, propsRecord);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'svelte') {
		const { hydrateSvelteIsland, isSvelteComponent } =
			await import('./hydrators/svelte');
		/* `getIslandComponent` unwraps an island component DEFINITION —
		 * what `defineIslandComponent` produces, `{ component, source }`.
		 * It has to run on the resolver's result too, not only on the
		 * registry lookup: a resolved island entry whose default export is
		 * a definition is an object, every `is…Component` guard rejects an
		 * object, and the island then failed to hydrate. */
		const resolvedComponent = getIslandComponent(
			(await resolveComponent?.(framework, componentName)) ??
				registry.svelte?.[componentName]
		);
		if (!isSvelteComponent(resolvedComponent))
			throw unresolvedIslandError(resolvedComponent);

		await hydratePreservingBrowserTranslation(element, () =>
			hydrateSvelteIsland(resolvedComponent, element, propsRecord)
		);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'vue') {
		const { hydrateVueIsland, isVueComponent } =
			await import('./hydrators/vue');
		/* `getIslandComponent` unwraps an island component DEFINITION —
		 * what `defineIslandComponent` produces, `{ component, source }`.
		 * It has to run on the resolver's result too, not only on the
		 * registry lookup: a resolved island entry whose default export is
		 * a definition is an object, every `is…Component` guard rejects an
		 * object, and the island then failed to hydrate. */
		const resolvedComponent = getIslandComponent(
			(await resolveComponent?.(framework, componentName)) ??
				registry.vue?.[componentName]
		);
		if (!isVueComponent(resolvedComponent))
			throw unresolvedIslandError(resolvedComponent);

		await hydratePreservingBrowserTranslation(element, () =>
			hydrateVueIsland(resolvedComponent, element, propsRecord)
		);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'angular') {
		const { mountAngularIsland, isAngularComponent } =
			await import('../angular/islands');
		/* `getIslandComponent` unwraps an island component DEFINITION —
		 * what `defineIslandComponent` produces, `{ component, source }`.
		 * It has to run on the resolver's result too, not only on the
		 * registry lookup: a resolved island entry whose default export is
		 * a definition is an object, every `is…Component` guard rejects an
		 * object, and the island then failed to hydrate. */
		const resolvedComponent = getIslandComponent(
			(await resolveComponent?.(framework, componentName)) ??
				registry.angular?.[componentName]
		);
		const { islandId } = element.dataset;
		if (!isAngularComponent(resolvedComponent) || !islandId)
			throw unresolvedIslandError(resolvedComponent);

		await hydratePreservingBrowserTranslation(element, () =>
			mountAngularIsland(
				resolvedComponent,
				element,
				propsRecord ?? {},
				islandId
			)
		);
		element.dataset.hydrated = 'true';
	}
};

const hydrateIsland = async (
	registry: RuntimeIslandRegistry,
	element: IslandElement,
	resolveComponent?: (
		framework: IslandFramework,
		component: string
	) => Promise<unknown>
) => {
	if (element.dataset.hydrated === 'true' || hydratingIslands.has(element)) {
		return;
	}

	const { framework } = element.dataset;
	const componentName = element.dataset.component;
	if (!framework || !componentName) return;

	const props = parseIslandProps(element.getAttribute('data-props'));
	hydratingIslands.add(element);
	ensureIslandStylesheet(framework, componentName);

	try {
		await hydrateByFramework(
			registry,
			framework,
			componentName,
			element,
			props,
			resolveComponent
		);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Unknown island error';
		element.dataset.error = message;
		console.error(
			`[islands] Failed to hydrate ${framework}:${componentName}`,
			error
		);
	} finally {
		hydratingIslands.delete(element);
	}
};

const scheduleIsland = (
	registry: RuntimeIslandRegistry,
	element: IslandElement,
	observer: IntersectionObserver | null,
	resolveComponent?: (
		framework: IslandFramework,
		component: string
	) => Promise<unknown>
) => {
	const mode = element.dataset.hydrate ?? 'load';
	if (mode === 'none') return;
	if (mode === 'load') {
		void hydrateIsland(registry, element, resolveComponent);

		return;
	}
	if (mode === 'idle') {
		requestIdle(
			() => void hydrateIsland(registry, element, resolveComponent)
		);

		return;
	}
	if (mode === 'visible' && observer) {
		observer.observe(element);

		return;
	}

	void hydrateIsland(registry, element, resolveComponent);
};

const collectIslandElements = (node: Node) => {
	const islands: IslandElement[] = [];
	if (isIslandElement(node)) islands.push(node);
	if (!(node instanceof Element)) return islands;

	const nested = node.querySelectorAll<IslandElement>('[data-island="true"]');
	for (const island of nested) {
		islands.push(island);
	}

	return islands;
};

type IslandHotUpdate = {
	component: string;
	framework: string;
	modulePath: string;
	/** The island's rebuilt stylesheet, when it has one. */
	stylePath?: string;
};

const remountByFramework = async (
	framework: string,
	component: unknown,
	element: IslandElement,
	props: unknown
) => {
	if (framework === 'react') {
		const { remountReactIsland, isReactComponent } =
			await import('./hydrators/react');
		if (!isReactComponent(component)) return false;
		remountReactIsland(component, element, props);

		return true;
	}
	if (framework === 'svelte') {
		const { remountSvelteIsland, isSvelteComponent } =
			await import('./hydrators/svelte');
		if (!isSvelteComponent(component)) return false;
		await remountSvelteIsland(component, element, props);

		return true;
	}
	if (framework === 'vue') {
		const { remountVueIsland, isVueComponent } =
			await import('./hydrators/vue');
		if (!isVueComponent(component)) return false;
		remountVueIsland(component, element, props);

		return true;
	}

	// Angular islands are bootstrapped applications; reload instead.
	return false;
};

const findIslandElements = (framework: string, component: string) =>
	Array.from(
		document.querySelectorAll<IslandElement>('[data-island="true"]')
	).filter(
		(element) =>
			element.dataset.framework === framework &&
			element.dataset.component === component
	);

const remountIslandElement = async (
	update: IslandHotUpdate,
	component: unknown,
	element: IslandElement
) => {
	// Not hydrated yet (`visible`/`idle`/`none`): its first hydration
	// happens later; nothing on screen runs the old code.
	if (element.dataset.hydrated !== 'true') return true;
	try {
		return await remountByFramework(
			update.framework,
			component,
			element,
			parseIslandProps(element.getAttribute('data-props'))
		);
	} catch (error) {
		console.error(
			`[islands] Failed to update ${update.framework}:${update.component}`,
			error
		);

		return false;
	}
};

/* Hand the rebuilt component to its framework's own HMR, which keeps the
 * island's state where that framework would on a page: React Fast Refresh
 * keeps hook state when the hooks are unchanged, Vue keeps state across a
 * template or style edit. Svelte's HMR recreates the component it swaps,
 * so a Svelte island re-mounts (its state starts over either way). False
 * sends every island to a re-mount. */
const updateWithFrameworkHmr = async (
	update: IslandHotUpdate,
	component: unknown,
	hydrated: IslandElement[],
	vueBefore: Record<string, unknown> | undefined
) => {
	if (update.framework === 'react') {
		const { refreshReactIslands } = await import('./hydrators/react');

		return refreshReactIslands(component, hydrated);
	}
	if (update.framework !== 'vue' || !vueBefore) return false;
	const { hotUpdateVueIslands } = await import('./hydrators/vue');

	return hotUpdateVueIslands(vueBefore, component, hydrated);
};

const updateInPlace = async (
	update: IslandHotUpdate,
	component: unknown,
	elements: IslandElement[],
	vueBefore: Record<string, unknown> | undefined
) => {
	// Not hydrated yet: nothing on screen runs the old code.
	const hydrated = elements.filter(
		(element) => element.dataset.hydrated === 'true'
	);
	if (hydrated.length === 0) return false;
	try {
		return await updateWithFrameworkHmr(
			update,
			component,
			hydrated,
			vueBefore
		);
	} catch (error) {
		console.warn(
			`[islands] ${update.framework}:${update.component} could not update in place, re-mounting`,
			error
		);

		return false;
	}
};

const applyIslandHotUpdate = async (update: IslandHotUpdate) => {
	const elements = findIslandElements(update.framework, update.component);
	if (elements.length === 0) return true;

	if (update.stylePath)
		swapIslandStylesheet(
			update.framework,
			update.component,
			update.stylePath
		);
	const vueBefore =
		update.framework === 'vue'
			? (await import('./hydrators/vue')).snapshotVueHmrComponents()
			: undefined;
	const loadedModule: { default?: unknown } = await import(update.modulePath);
	if (await updateInPlace(update, loadedModule.default, elements, vueBefore))
		return true;
	const results = await Promise.all(
		elements.map((element) =>
			remountIslandElement(update, loadedModule.default, element)
		)
	);

	return results.every(Boolean);
};

/* Dev HMR entry point (see Window['__ABS_ISLAND_HMR__']): re-mount every
 * island on this page that renders one of the rebuilt components. */
const applyIslandHotUpdates = async (updates: IslandHotUpdate[]) => {
	try {
		const results = await Promise.all(updates.map(applyIslandHotUpdate));

		return results.every(Boolean);
	} catch (error) {
		console.error('[islands] Failed to load an updated island', error);

		return false;
	}
};

/* On a React page the page's own root must exist before any island root.
 * React DOM listens for events once per document: the first root created
 * in it marks the document as listened to, and a root created on the
 * document afterwards skips registering its listeners, so the whole page
 * (everything outside the islands) never handles an event. The islands
 * bootstrap often runs first, since the page's module graph is larger, so
 * a React page's islands wait for its root (the page's index dispatches
 * REACT_PAGE_ROOT_EVENT), or for `load`, by which time the page's script
 * has run or failed. */
const waitForReactPageRoot = () => {
	if (Reflect.get(window, '__ABS_ISLAND_HOST__') !== 'react')
		return undefined;
	if (window.__REACT_ROOT__ || document.readyState === 'complete')
		return undefined;

	return new Promise<void>((resolve) => {
		const done = () => {
			window.removeEventListener(REACT_PAGE_ROOT_EVENT, done);
			window.removeEventListener('load', done);
			resolve();
		};
		window.addEventListener(REACT_PAGE_ROOT_EVENT, done);
		window.addEventListener('load', done);
	});
};

const scheduleIslands = ({
	registry,
	resolveComponent,
	root = document.documentElement
}: StartIslandsOptions) => {
	const targetRoot = root instanceof Document ? root.documentElement : root;

	const observer =
		typeof IntersectionObserver === 'undefined'
			? null
			: new IntersectionObserver((entries) => {
					for (const entry of entries) {
						if (!entry.isIntersecting) continue;
						if (!isIslandElement(entry.target)) continue;

						observer?.unobserve(entry.target);
						void hydrateIsland(
							registry,
							entry.target,
							resolveComponent
						);
					}
				});

	const islands = targetRoot.querySelectorAll<IslandElement>(
		'[data-island="true"]'
	);
	for (const island of islands) {
		scheduleIsland(registry, island, observer, resolveComponent);
	}

	if (typeof MutationObserver === 'undefined') return;
	if (observedRoots.has(targetRoot)) return;

	const mutationObserver = new MutationObserver((records) => {
		const addedIslands = records.flatMap((record) =>
			Array.from(record.addedNodes).flatMap(collectIslandElements)
		);
		for (const island of addedIslands) {
			scheduleIsland(registry, island, observer, resolveComponent);
		}
	});

	observedRoots.add(targetRoot);
	mutationObserver.observe(targetRoot, {
		childList: true,
		subtree: true
	});
};

export const startIslands = (options: StartIslandsOptions) => {
	if (typeof window !== 'undefined') {
		window.__ABS_ISLAND_HMR__ = applyIslandHotUpdates;
	}
	const pageRoot =
		typeof window === 'undefined' ? undefined : waitForReactPageRoot();
	if (pageRoot) {
		void pageRoot.then(() => scheduleIslands(options));

		return;
	}
	scheduleIslands(options);
};
