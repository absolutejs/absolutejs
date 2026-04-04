import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import {
	getIslandMarkerAttributes,
	serializeIslandAttributes
} from '../core/islandMarkupAttributes';

export const createTypedIsland =
	<T extends IslandRegistryInput>(_registry: IslandRegistry<T>) =>
	(props: TypedIslandRenderProps<T>) => {
		const attributes = getIslandMarkerAttributes(props);

		return `<div ${serializeIslandAttributes(attributes)}></div>`;
	};
