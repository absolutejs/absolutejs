import type { RuntimeIslandRenderProps } from '../../types/island';
import { getIslandMarkerAttributes } from '../core/islandMarkupAttributes';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { renderIslandResult } from '../core/renderIslandMarkup';

export const Island = async (props: RuntimeIslandRenderProps) => {
	if (typeof window !== 'undefined') {
		return (
			<div
				{...getIslandMarkerAttributes(props)}
				suppressHydrationWarning
			/>
		);
	}

	const result = await renderIslandResult(
		requireCurrentIslandRegistry(),
		props
	);

	return (
		<div
			{...result.attributes}
			dangerouslySetInnerHTML={{ __html: result.html }}
		/>
	);
};
