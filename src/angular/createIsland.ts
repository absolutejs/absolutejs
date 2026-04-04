import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import { renderIslandMarkup } from '../core/renderIslandMarkup';

export const createTypedIsland =
	<T extends IslandRegistryInput>(registry: IslandRegistry<T>) =>
	(props: TypedIslandRenderProps<T>) =>
		renderIslandMarkup(registry, props);
