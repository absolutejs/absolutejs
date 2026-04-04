import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';

export const createTypedIsland = <T extends IslandRegistryInput>(
	_registry: IslandRegistry<T>
) => {
	const Island = (props: TypedIslandRenderProps<T>) => {
		const { attributes, innerHTML } = preserveIslandMarkup(props);

		return (
			<div
				{...attributes}
				dangerouslySetInnerHTML={{ __html: innerHTML }}
				suppressHydrationWarning
			/>
		);
	};

	return Island;
};
