export type AngularDeferSlotPayload = {
	data?: Record<string, string>;
	/** Size-accounting only: the streaming pipeline measures it for
	 *  `maxSlotHtmlSizeBytes` and slot metrics. Never insert it into the DOM;
	 *  the slot renders from `data` through Angular's own escaping, and the
	 *  stream-swap runtime deliberately skips `angular-defer` payloads.
	 *  Interpolated values in it are HTML-escaped at build time. */
	html: string;
	kind: 'angular-defer';
	state?: 'error' | 'resolved';
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

export const isAngularDeferSlotPayload = (
	value: unknown
): value is AngularDeferSlotPayload => {
	if (!isObjectRecord(value)) return false;

	return value.kind === 'angular-defer' && typeof value.html === 'string';
};
