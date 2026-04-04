import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { renderIslandResult } from '../core/renderIslandMarkup';

export const createTypedIsland = <T extends IslandRegistryInput>(
	registry: IslandRegistry<T>
) => {
	const Island = async (props: TypedIslandRenderProps<T>) => {
		if (typeof window !== 'undefined') {
			return (
				<div
					{...getIslandMarkerAttributes(props)}
					suppressHydrationWarning
				/>
			);
		}
		const result = await renderIslandResult(registry, props);

		return (
			<div
				{...result.attributes}
				dangerouslySetInnerHTML={{ __html: result.html }}
			/>
		);
	};

	return Island;
};
