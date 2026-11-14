import type {
	IslandRegistry,
	IslandRegistryInput,
	TypedIslandRenderProps
} from '../../types/island';
import {
	getStableInnerHtml,
	preserveIslandMarkup
} from '../client/preserveIslandMarkup';
import { IslandWithStylesheet } from './IslandStyleLink';

export const createTypedIsland = <T extends IslandRegistryInput>(
	_registry: IslandRegistry<T>
) => {
	const Island = (props: TypedIslandRenderProps<T>) => {
		const { attributes, innerHTML } = preserveIslandMarkup(props);

		return (
			<IslandWithStylesheet
				component={props.component}
				framework={props.framework}
				marker={{
					...attributes,
					dangerouslySetInnerHTML: getStableInnerHtml(innerHTML),
					suppressHydrationWarning: true
				}}
			/>
		);
	};

	return Island;
};
