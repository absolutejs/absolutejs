import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`streaming: true` on a Vue page handler sends the page's shell before its slowest async boundary resolves — 11ms to first byte against 616ms for the same page rendered atomically, on a page with a 600ms boundary. It is opt-in per page rather than the default, and the reason is worth knowing before switching: a Vue render that fails ASYNCHRONOUSLY, an async component or a `setup` that throws deep in the page, can only be answered with a 500 error page while nothing has been committed. Streaming commits the status and the opening markup first, so the same failure truncates the response instead. A failure before the first chunk is answerable in either mode, because the streaming path primes the stream before committing a response. Pages that collect streaming slots keep streaming regardless, as they always have: their contract is patch delivery, which needs the response open.",
	kind: 'added',
	summary: 'Vue pages can stream with `streaming: true`'
};
