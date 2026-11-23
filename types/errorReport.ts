/** Where a server-side error came from.
 *
 *  `page` is a render that threw before anything was sent, so the visitor
 *  got an error page. `stream` is a render that threw after the first byte
 *  — the visitor has a partial page and no status code can say so, which
 *  is why these are worth telling apart. `hole` is a partial-prerender
 *  slot that failed, leaving its fallback in place: the visitor got a
 *  usable page, so it is a degradation rather than a failure. `load` is a
 *  file route's `load` function. */
export type ServerErrorKind = 'hole' | 'load' | 'page' | 'stream';

export type ServerErrorReport = {
	error: unknown;
	/** Which framework's handler, or the route source for a `load`. */
	framework?: string;
	kind: ServerErrorKind;
	method?: string;
	path?: string;
	/** The page or route this happened in, when known. */
	page?: string;
	/** The current request's correlation id, so a report lines up with the
	 *  access log line and with whatever the visitor was told. */
	requestId?: string;
};

/** Notified of every server-side error. Return value ignored; a promise is
 *  not awaited, so reporting never delays the response. */
export type ServerErrorReporter = (report: ServerErrorReport) => unknown;
