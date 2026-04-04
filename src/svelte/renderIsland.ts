import type { RuntimeIslandRenderProps } from '../../types/island';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { renderIslandMarkup } from '../core/renderIslandMarkup';

export const renderIsland = (props: RuntimeIslandRenderProps) =>
	renderIslandMarkup(requireCurrentIslandRegistry(), props);
