/* The id that ties a log line, a response and a report of a problem to one
 * request.
 *
 * A load balancer or proxy usually assigns one already and forwards it, so
 * the rule is to adopt an inbound id when there is one and mint one
 * otherwise — that is what makes a trace span the hops rather than
 * restarting at this process. Which means the id is client-controlled text
 * that goes straight into a log line, and that is why this is a module
 * rather than one call to `headers.get()`.
 *
 * What the threat is NOT, measured rather than assumed. A log-forging
 * `x-request-id: a"}\n{"level":"info"` cannot reach a handler: `new
 * Request()` refuses a header value containing CR, LF or NUL, and over a
 * real socket the HTTP parser ends the value at the CRLF — a probe sending
 * that line byte by byte arrived as the value `a"}` plus a separate
 * `X-Injected` header. So nothing here needs to escape newlines, and
 * nobody should add that later believing it closes a hole.
 *
 * What does arrive intact, all of it accepted by `new Request()` and by the
 * wire: ANSI escapes (`\u001b[31m…`, which rewrites a terminal watching
 * `logging: { requests: 'text' }`), quotes, spaces and tabs (which make a
 * text line ambiguous: `req=two words`), 10 KB of padding (a client
 * choosing how many bytes per request this process writes to disk), and
 * non-ASCII.
 *
 * So an inbound value is adopted only when it already looks like an id, and
 * REPLACED when it does not — not escaped and kept, because an id that no
 * longer matches the one the proxy recorded correlates with nothing, and
 * not dropped, because a log line with no id is as hard to trace as no log
 * line at all.
 *
 * Pure: a request in, a string out. */

/** Long enough for a UUID (36) or an X-Ray trace header (about 70 with its
 *  `Parent` and `Sampled` parts), short enough that a client cannot choose
 *  how many bytes each of this process's log lines costs. */
const MAX_REQUEST_ID_LENGTH = 96;

/** What an id may contain: the characters UUIDs, hex trace ids, ULIDs and
 *  the `key=value;key=value` trace headers (AWS X-Ray, Google Cloud) use.
 *  No whitespace, no quotes, no control characters — nothing a terminal
 *  acts on or a text log line is ambiguous about. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:;=@-]+$/u;

/** The default inbound header. `x-request-id` is the common convention;
 *  AWS sends `x-amzn-trace-id` and Google Cloud `x-cloud-trace-context`,
 *  which is why the header is configurable rather than fixed. */
export const DEFAULT_REQUEST_ID_HEADER = 'x-request-id';

/** The response header the id is echoed on, so a client can quote it. */
export const REQUEST_ID_RESPONSE_HEADER = 'x-request-id';

/** A fresh id. `randomUUID` is the obvious choice and is not free, so this
 *  is only ever called for a request that has no usable inbound id, and
 *  only when something actually asks for the id. */
export const newRequestId = () => crypto.randomUUID();

/** This request's id: the inbound one when it is usable, otherwise a new
 *  one. */
export const requestIdFor = (
	request: Request,
	header: string = DEFAULT_REQUEST_ID_HEADER
) => usableRequestId(request.headers.get(header)) ?? newRequestId();

/* The header this app adopts ids from, set once at boot from
 * `logging.requestIdHeader`.
 *
 * It has to be reachable from more than the access log. The id is
 * memoized per request by whoever asks first, and an error report asks
 * during the request while the log line asks after it — so if the error
 * path used the default name while the config said `x-amzn-trace-id`, the
 * report would mint a fresh id, the log line would reuse that minted one,
 * and the proxy's id would be adopted by neither. One place to read the
 * name means every caller agrees. */
let configuredHeader: string = DEFAULT_REQUEST_ID_HEADER;

/** The configured inbound header name. */
export const requestIdHeader = () => configuredHeader;

/** Set at boot. `undefined` restores the default, so a runtime rebuilt in
 *  place without logging configured does not keep the old name. */
export const setRequestIdHeader = (header: string | undefined) => {
	configuredHeader = header ?? DEFAULT_REQUEST_ID_HEADER;
};

/** An inbound header value if it is usable as an id, else null.
 *
 *  Only the first value of a comma-separated list is considered: a chain of
 *  proxies may append, and the client's own hop is first. */
export const usableRequestId = (value: string | null) => {
	if (value === null) return null;
	const first = (value.split(',')[0] ?? '').trim();
	if (first === '' || first.length > MAX_REQUEST_ID_LENGTH) return null;

	return REQUEST_ID_PATTERN.test(first) ? first : null;
};
