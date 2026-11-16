import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Eden typed a form action route\'s response as a raw `Response`, because the route built the answer for each caller itself. The route now answers with typed values, the handler\'s data on success and the field errors with a 422 on failure (including validation errors), and a `mapResponse` hook turns them into the 303 redirect, HTMX fragment or browser-helper JSON those callers expect. Eden now types `data` as `{ status: \'success\', data }` and the 422 `error` as the field errors keyed by the schema\'s fields. Responses to every caller are unchanged.',
	kind: 'fixed',
	summary: 'Eden types a form action\'s success data and field errors instead of `Response`'
};
