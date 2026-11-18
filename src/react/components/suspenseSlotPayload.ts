/** The streamed payload of a React SuspenseSlot rendered through
 *  `children(value)`: its HTML for the page to show at once, and the value
 *  for the browser to render the same children interactively. */
export const REACT_SUSPENSE_PAYLOAD_KIND = 'react-suspense';

export type ReactSuspensePayload = {
	html: string;
	kind: typeof REACT_SUSPENSE_PAYLOAD_KIND;
	state: 'error' | 'resolved';
	value?: unknown;
};

export const isReactSuspensePayload = (
	payload: unknown
): payload is ReactSuspensePayload =>
	typeof payload === 'object' &&
	payload !== null &&
	'kind' in payload &&
	payload.kind === REACT_SUSPENSE_PAYLOAD_KIND;
