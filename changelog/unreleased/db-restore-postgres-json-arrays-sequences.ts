import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'json/jsonb values were stringified before binding, and Bun SQL JSON-encodes bound values, so every document was restored as a JSON string scalar. Array columns failed to bind, bytea values are now decoded from their backed-up Buffer JSON, `generated always` identity and generated columns were rejected, and serial/identity sequences were left behind the restored ids so the next insert collided.',
	kind: 'fixed',
	summary:
		'`absolute db restore` into PostgreSQL keeps JSON documents, arrays, bytea, identity columns and sequences intact'
};
