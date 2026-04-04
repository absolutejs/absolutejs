import type {
	IslandComponentDefinition,
	IslandRegistry,
	IslandRegistryInput
} from '../../types/island';

export const defineIslandComponent = <Component>(
	component: Component,
	options: {
		export?: string;
		source: string;
	}
): IslandComponentDefinition<Component> => ({
	component,
	export: options.export,
	source: options.source
});
export const defineIslandRegistry = <T extends IslandRegistryInput>(
	registry: IslandRegistry<T>
) => registry;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const getIslandBuildReference = <Component>(
	component: Component | IslandComponentDefinition<Component>
) => {
	if (!isIslandComponentDefinition(component)) return null;

	return {
		export: component.export,
		source: component.source
	};
};
export const isIslandComponentDefinition = <Component>(
	value: Component | IslandComponentDefinition<Component>
): value is IslandComponentDefinition<Component> =>
	isRecord(value) &&
	'component' in value &&
	'source' in value &&
	typeof value.source === 'string';

export function getIslandComponent<Component>(component: Component): Component;
export function getIslandComponent<Component>(
	component: IslandComponentDefinition<Component>
): Component;
export function getIslandComponent<Component>(
	component: Component | IslandComponentDefinition<Component>
) {
	if (isIslandComponentDefinition(component)) {
		return component.component;
	}

	return component;
}
export const parseIslandProps = (rawProps: string | null) => {
	if (!rawProps) return {};

	return JSON.parse(rawProps);
};
export const serializeIslandProps = (props: unknown) =>
	JSON.stringify(props ?? {});

export {
	getIslandManifestEntries,
	getIslandManifestKey
} from './islandManifest';
