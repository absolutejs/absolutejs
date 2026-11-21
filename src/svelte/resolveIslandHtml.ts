import type { RuntimeIslandRenderProps } from '../../types/island';
import { requireCurrentIslandRegistry } from '../core/currentIslandRegistry';
import { renderIslandMarkup } from '../core/renderIslandMarkup';

/** Svelte actions do not run during server rendering, and the server
 *  renders the island markup into the slot itself. This exists so the one
 *  import the island lowering emits resolves in both builds; the browser
 *  build has the real one. */
export const absoluteIslandSlot = () => undefined;

export const resolveIslandHtml = (
	_slotId: string,
	props: RuntimeIslandRenderProps
) => renderIslandMarkup(requireCurrentIslandRegistry(), props);
