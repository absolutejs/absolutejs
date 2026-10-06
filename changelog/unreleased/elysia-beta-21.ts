import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "AbsoluteJS depends on, and peers with, Elysia `2.0.0-beta.21` (from `2.0.0-beta.6`). Apps should move to the same version. One change can surface in your code: in a general `.error()` handler, `error` is now typed `unknown`, since anything can be thrown, so read its message with `error instanceof Error ? error.message : String(error)`. Deferred plugins (`lazyPlugin`) now republish the route table through Elysia's public fetch handler, because the internal method they used became private.",
	kind: 'changed',
	summary: 'Elysia is now 2.0.0-beta.21'
};
