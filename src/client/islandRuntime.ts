import type { IslandFramework } from '../../types/island';
import { getIslandComponent, parseIslandProps } from '../core/islands';
import { initializeIslandMarkupSnapshot } from './preserveIslandMarkup';

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

// Framework-specific hydrators are dynamic-imported on first use so the
// island runtime never statically pulls in a framework's runtime (and its
// transitive deps) the consumer doesn't actually use. Without this, a
// React-only project loading `@absolutejs/absolute/client` would resolve
// every framework's peer deps — including `@angular/core` — and fail at
// module load if any of them weren't installed.
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
		const { hydrateReactIsland, isReactComponent } = await import(
			'./hydrators/react'
		);
		const resolvedComponent =
			(await resolveComponent?.(framework, componentName)) ??
			getIslandComponent(registry.react?.[componentName]);
		if (!isReactComponent(resolvedComponent)) return;

		hydrateReactIsland(resolvedComponent, element, propsRecord);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'svelte') {
		const { hydrateSvelteIsland, isSvelteComponent } = await import(
			'./hydrators/svelte'
		);
		const resolvedComponent =
			(await resolveComponent?.(framework, componentName)) ??
			getIslandComponent(registry.svelte?.[componentName]);
		if (!isSvelteComponent(resolvedComponent)) return;

		hydrateSvelteIsland(resolvedComponent, element, propsRecord);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'vue') {
		const { hydrateVueIsland, isVueComponent } = await import(
			'./hydrators/vue'
		);
		const resolvedComponent =
			(await resolveComponent?.(framework, componentName)) ??
			getIslandComponent(registry.vue?.[componentName]);
		if (!isVueComponent(resolvedComponent)) return;

		hydrateVueIsland(resolvedComponent, element, propsRecord);
		element.dataset.hydrated = 'true';

		return;
	}

	if (framework === 'angular') {
		const { mountAngularIsland, isAngularComponent } = await import(
			'../angular/islands'
		);
		const resolvedComponent =
			(await resolveComponent?.(framework, componentName)) ??
			getIslandComponent(registry.angular?.[componentName]);
		const { islandId } = element.dataset;
		if (!isAngularComponent(resolvedComponent) || !islandId) return;

		await mountAngularIsland(
			resolvedComponent,
			element,
			propsRecord ?? {},
			islandId
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

export const startIslands = ({
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
