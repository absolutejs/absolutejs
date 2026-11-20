import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A POST to a form route with no content-type gave Elysia nothing to parse, so the body stayed undefined and the schema reported a single error against the whole body: `{ '': 'must be object' }`. A form shows its errors next to fields, so that message had nowhere to render, and `must be object` is the validator's own language rather than anything a visitor should read. Such a submission is now validated as an empty object, which reports every required field as Required — the shape the rest of the pipeline already expects. A request that declares a content-type is parsed exactly as before. Validation was never skipped and the handler never ran, so this changes the errors a malformed submission reports, not whether it is rejected.",
	kind: 'fixed',
	summary: 'A submission with no content-type reports per-field errors',
	symbols: ['formActions']
};
