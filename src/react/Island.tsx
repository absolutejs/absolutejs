import type {
	IslandRegistry,
	IslandRegistryInput,
	RuntimeIslandRenderProps
} from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { renderIslandResult } from '../core/renderIslandMarkup';
import { IslandStyleLink, IslandWithStylesheet } from './IslandStyleLink';

type ServerIslandProps = {
	island: RuntimeIslandRenderProps;
	registry: IslandRegistry<IslandRegistryInput>;
};

export const Island = (props: RuntimeIslandRenderProps) => {
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

	return (
		<ServerIsland
			island={props}
			registry={requireCurrentIslandRegistry()}
		/>
	);
};

/** The island's server render, preceded by its stylesheet. */
export const ServerIsland = async ({ island, registry }: ServerIslandProps) => {
	const { attributes, html } = await renderIslandResult(registry, island);

	return (
		<>
			<IslandStyleLink
				component={island.component}
				framework={island.framework}
			/>
			<div {...attributes} dangerouslySetInnerHTML={{ __html: html }} />
		</>
	);
};
