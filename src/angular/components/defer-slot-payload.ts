export type AngularDeferSlotPayload = {
	data?: Record<string, string>;
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
