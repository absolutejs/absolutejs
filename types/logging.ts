/** How an access log line is written: `json` for one object per line that
 *  a log pipeline parses, `text` for a human reading a terminal. */
export type AccessLogFormat = 'json' | 'text';

export type LoggingConfig = {
	/** Log one line per request. `true` means `'json'`; `false` (the
	 *  default) logs nothing.
	 *
	 *  Off by default on purpose: a log line per request is a cost and a
	 *  volume decision that belongs to whoever runs the thing, and a
	 *  framework that starts writing to your stdout without being asked is
	 *  a framework you have to configure before you can use it. */
	requests?: boolean | AccessLogFormat;
	/** Echo the request's correlation id on the response as
	 *  `x-request-id`, so a client — or a user reporting a problem — can
	 *  quote the id the server logged. Default `true` whenever `requests`
	 *  is on. */
	echoRequestId?: boolean;
	/** Write each line as its request finishes instead of batching.
	 *
	 *  Batching is the default and costs about 4.7µs per request against
	 *  15.8µs unbatched (measured in `src/core/accessLogSink.ts`). What it
	 *  risks is the tail: a process killed by a signal loses at most 50ms
	 *  or 256 lines, which are the lines someone investigating that death
	 *  would want. Set this when that matters more than the throughput. */
	flushEachLine?: boolean;
	/** The inbound header to adopt an id from. Default `x-request-id`;
	 *  `x-amzn-trace-id` on AWS, `x-cloud-trace-context` on Google Cloud.
	 *  A value that does not look like an id is replaced rather than
	 *  escaped — see `src/core/requestId.ts`. */
	requestIdHeader?: string;
};
