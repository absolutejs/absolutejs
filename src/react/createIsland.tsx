import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { ServerIsland } from './Island';
import { IslandWithStylesheet } from './IslandStyleLink';

export const createTypedIsland = <T extends IslandRegistryInput>(
	registry: IslandRegistry<T>
) => {
	const Island = (props: TypedIslandRenderProps<T>) => {
		if (typeof window !== 'undefined') {
			return (
				<IslandWithStylesheet
					component={props.component}
					framework={props.framework}
					marker={{
						...getIslandMarkerAttributes(props),
						suppressHydrationWarning: true
					}}
				/>
			);
		}

		return <ServerIsland island={props} registry={registry} />;
	};

	return Island;
};
