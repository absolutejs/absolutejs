import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import {
	renderAngularIslandToHtml,
	renderReactIslandToHtml,
	renderSvelteIslandToHtml,
	renderVueIslandToHtml
} from './islandSsr';
import { compileSvelteServerModule } from './svelteServerModule';
import {
	getIslandMarkerAttributes,
	serializeIslandAttributes
} from './islandMarkupAttributes';
import { getIslandBuildReference, getIslandComponent } from './islands';

let islandSequence = 0;
const resolvedServerComponentCache = new Map<unknown, Promise<unknown>>();
const resolvedServerBuildComponentCache = new Map<string, Promise<unknown>>();

const nextIslandId = () => {
	islandSequence += 1;

	return `island-${islandSequence}`;
};

type AngularServerIslandComponent = import('@angular/core').Type<object>;
type ReactServerIslandComponent = import('react').ComponentType<
	Record<string, unknown>
>;
type SvelteServerIslandComponent = import('svelte').Component<
	Record<string, unknown>
>;
type VueServerIslandComponent = import('vue').Component<
	Record<string, unknown>
>;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isReactServerIslandComponent = (
	value: unknown
): value is ReactServerIslandComponent => typeof value === 'function';

const isSvelteServerIslandComponent = (
	value: unknown
): value is SvelteServerIslandComponent => typeof value === 'function';

const isVueServerIslandComponent = (
	value: unknown
): value is VueServerIslandComponent =>
	typeof value === 'function' || isRecord(value);

const isAngularServerIslandComponent = (
	value: unknown
): value is AngularServerIslandComponent => typeof value === 'function';

const resolveBuildReferencePath = (source: string, registryPath: string) => {
	if (source.startsWith('file://')) return new URL(source).pathname;
	if (source.startsWith('.')) return new URL(source, registryPath).pathname;

	return source;
};

const loadAndCompileServerBuildComponent = async (
	buildReferencePath: string
) => {
	const compiledModulePath =
		await compileSvelteServerModule(buildReferencePath);
	const loadedModule = await import(compiledModulePath);

	return 'default' in loadedModule ? loadedModule.default : loadedModule;
};

const loadServerBuildComponent = async (buildReferencePath: string) => {
	const cachedBuildComponent =
		resolvedServerBuildComponentCache.get(buildReferencePath);
	if (cachedBuildComponent) {
		return cachedBuildComponent;
	}

	const loadPromise = loadAndCompileServerBuildComponent(buildReferencePath);
	resolvedServerBuildComponentCache.set(buildReferencePath, loadPromise);

	return loadPromise;
};

const loadServerImportComponent = async (resolvedComponent: string) => {
	const resolvedModulePath = resolvedComponent.startsWith('.')
		? new URL(resolvedComponent, import.meta.url).pathname
		: resolvedComponent;
	const importTarget = resolvedModulePath.endsWith('.svelte')
		? await compileSvelteServerModule(resolvedModulePath)
		: resolvedModulePath;
	const loadedModule = await import(importTarget);

	return 'default' in loadedModule ? loadedModule.default : loadedModule;
};

const resolveIslandComponent = async (component: unknown) => {
	const buildReference = getIslandBuildReference(component);
	const buildReferencePath = buildReference?.source
		? resolveBuildReferencePath(buildReference.source, import.meta.url)
		: null;
	if (buildReferencePath?.endsWith('.svelte')) {
		return loadServerBuildComponent(buildReferencePath);
	}

	const resolvedComponent = getIslandComponent(component);
	if (typeof resolvedComponent !== 'string') {
		return resolvedComponent;
	}

	return loadServerImportComponent(resolvedComponent);
};

const resolveServerIslandComponent = async (component: unknown) => {
	const cachedResolvedComponent = resolvedServerComponentCache.get(component);
	if (cachedResolvedComponent) {
		return cachedResolvedComponent;
	}

	const resolutionPromise = resolveIslandComponent(component);

	resolvedServerComponentCache.set(component, resolutionPromise);

	return resolutionPromise;
};

const resolveReactServerIslandComponent = async (component: unknown) => {
	const resolvedComponent = await resolveServerIslandComponent(component);
	if (!isReactServerIslandComponent(resolvedComponent)) {
		throw new Error(
			'Resolved React island is not a valid React component.'
		);
	}

	return resolvedComponent;
};

const resolveSvelteServerIslandComponent = async (component: unknown) => {
	const resolvedComponent = await resolveServerIslandComponent(component);
	if (!isSvelteServerIslandComponent(resolvedComponent)) {
		throw new Error(
			'Resolved Svelte island is not a valid Svelte component.'
		);
	}

	return resolvedComponent;
};

const resolveVueServerIslandComponent = async (component: unknown) => {
	const resolvedComponent = await resolveServerIslandComponent(component);
	if (!isVueServerIslandComponent(resolvedComponent)) {
		throw new Error('Resolved Vue island is not a valid Vue component.');
	}

	return resolvedComponent;
};

const resolveAngularServerIslandComponent = async (component: unknown) => {
	const resolvedComponent = await resolveServerIslandComponent(component);
	if (!isAngularServerIslandComponent(resolvedComponent)) {
		throw new Error(
			'Resolved Angular island is not a valid Angular component.'
		);
	}

	return resolvedComponent;
};

export const renderIslandMarkup = async <T extends IslandRegistryInput>(
	registry: IslandRegistry<T> | T,
	props: RuntimeIslandRenderProps
) => {
	const result = await renderIslandResult(registry, props);

	return `<div ${serializeIslandAttributes(result.attributes)}>${result.html}</div>`;
};
export const renderIslandResult = async <T extends IslandRegistryInput>(
	registry: IslandRegistry<T> | T,
	props: RuntimeIslandRenderProps
) => {
	const islandId = nextIslandId();
	const attributes = getIslandMarkerAttributes(props);

	if (props.framework === 'react') {
		const entry = registry.react?.[props.component];
		if (!entry) {
			throw new Error(
				`Island component "${props.component}" is not registered for framework "react".`
			);
		}
		const component = await resolveReactServerIslandComponent(entry);
		const html = renderReactIslandToHtml(component, props.props);

		return { attributes, html };
	}

	if (props.framework === 'svelte') {
		const entry = registry.svelte?.[props.component];
		if (!entry) {
			throw new Error(
				`Island component "${props.component}" is not registered for framework "svelte".`
			);
		}
		const component = await resolveSvelteServerIslandComponent(entry);
		const html = renderSvelteIslandToHtml(component, props.props);

		return { attributes, html };
	}

	if (props.framework === 'vue') {
		const entry = registry.vue?.[props.component];
		if (!entry) {
			throw new Error(
				`Island component "${props.component}" is not registered for framework "vue".`
			);
		}
		const component = await resolveVueServerIslandComponent(entry);
		const html = await renderVueIslandToHtml(component, props.props);

		return { attributes, html };
	}

	if (props.framework === 'angular') {
		const entry = registry.angular?.[props.component];
		if (!entry) {
			throw new Error(
				`Island component "${props.component}" is not registered for framework "angular".`
			);
		}
		const component = await resolveAngularServerIslandComponent(entry);
		const html = await renderAngularIslandToHtml(
			component,
			props.props,
			islandId
		);

		return {
			attributes: {
				...getIslandMarkerAttributes(props, islandId)
			},
			html
		};
	}

	throw new Error(
		`Framework "${props.framework}" is not implemented in this prototype.`
	);
};
