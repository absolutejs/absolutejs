/* The access log, as an Elysia plugin.
 *
 * Mounted only when `logging.requests` is set, so a project that does not
 * ask for it pays nothing — not the timing, not the header write, not the
 * id. `getCurrentRequestId()` computes the id on first use, and when this
 * plugin is absent nothing uses it.
 *
 * Timing lives in a WeakMap keyed by the Request, which is how the dev
 * request inspector does it: the async context would also carry it, but a
 * map keyed by a value the GC already tracks costs nothing to clean up and
 * cannot be confused by a handler that spawns work of its own. */

import { Elysia } from 'elysia';
import { accessLogLine, type AccessLogRecord } from '../core/accessLog';
import {
	createAccessLogSink,
	flushAccessLogOnExit
} from '../core/accessLogSink';
import { getCurrentRequestId } from '../core/requestContext';
import { REQUEST_ID_RESPONSE_HEADER } from '../core/requestId';
import type { AccessLogFormat, LoggingConfig } from '../../types/logging';

const DEFAULT_STATUS = 200;

/* Where the framework's own endpoints live: health probes, the vitals
 * collector, the dev request inspector. */
const INTERNAL_PREFIX = '/__absolute/';

const started = new WeakMap<Request, number>();

const formatOf = (requests: LoggingConfig['requests']) => {
	const format: AccessLogFormat = requests === 'text' ? 'text' : 'json';

	return format;
};

const pathOf = (url: string) => {
	const start = url.indexOf('/', url.indexOf('://') + 3);

	return start === -1 ? '/' : url.slice(start);
};

const byteSize = (header: unknown) => {
	if (typeof header !== 'string') return null;
	const size = Number(header);

	return Number.isFinite(size) ? size : null;
};

/** Nothing, when logging is off. A disabled plugin still has to be a
 *  plugin: the runtime chains `.use()` it unconditionally, and an Elysia
 *  instance with no hooks is the cheapest way to say "not enabled" without
 *  three call sites each testing the config. */
export const requestLog = (logging: LoggingConfig | undefined) => {
	if (!logging?.requests)
		return new Elysia({ name: 'absolutejs-request-log-disabled' });

	const format = formatOf(logging.requests);
	const header = logging.requestIdHeader;
	const echo = logging.echoRequestId !== false;
	const logInternal = logging.logInternalRequests === true;
	/* Batched by default: a write per request costs 15.8µs against 4.7µs
	 * batched, measured in accessLogSink.ts. */
	const sink = createAccessLogSink({
		flushEachLine: logging.flushEachLine === true
	});
	flushAccessLogOnExit(sink);

	return new Elysia({ name: 'absolutejs-request-log' })
		.onRequest(({ request, set }) => {
			started.set(request, performance.now());
			/* Set on the way in rather than on the way out: a request that
			 * ends in an error or a 404 never reaches a handler, and that
			 * is exactly the request whose id someone will want to quote. */
			if (echo)
				set.headers[REQUEST_ID_RESPONSE_HEADER] =
					getCurrentRequestId(header) ?? '';
		})
		.onAfterResponse(({ request, set }) => {
			const begin = started.get(request);
			started.delete(request);
			const path = pathOf(request.url);
			/* Framework-internal traffic is not the app's traffic. A
			 * readiness probe every two seconds is 43,200 lines a day that
			 * say nothing about anyone using the site, and it would arrive
			 * the moment someone turned on the access log — the dev request
			 * inspector skips the same prefix for the same reason.
			 * `logInternal` keeps it available for debugging a probe. */
			if (!logInternal && path.startsWith(INTERNAL_PREFIX)) return;
			const record: AccessLogRecord = {
				durationMs: begin === undefined ? 0 : performance.now() - begin,
				method: request.method,
				path,
				requestId: getCurrentRequestId(header) ?? '',
				size: byteSize(set.headers['content-length']),
				status:
					typeof set.status === 'number' ? set.status : DEFAULT_STATUS
			};
			sink.emit(accessLogLine(record, format));
		})
		.as('global');
};
