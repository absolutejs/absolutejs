import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'maxBodySize was enforced from content-length, which a chunked request does not send — fetch with a stream body, or any client using Transfer-Encoding: chunked. Such a request declared nothing, passed the check, and could then send as much as it liked, so a route with maxBodySize: 10 would hand its handler megabytes. When nothing is declared the body is now read with a cap and stops at the first chunk that crosses it, so a rejected request costs memory bounded by the limit rather than by what the client chose to send, and the submission gets the same 413 a declared oversize body gets. The bytes already read are served back through the same request rather than parsed here, which keeps Elysia the only thing that parses a body: a chunked body therefore cannot reach a handler in a different shape from a declared one.',
	kind: 'security',
	summary: 'maxBodySize now applies to a request that declares no size',
	symbols: ['formActions']
};
