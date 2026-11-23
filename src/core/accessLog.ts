/* One line per request: what was asked for, what came back, how long it
 * took, and the id that ties it to everything else about that request.
 *
 * The framework had no access log at all. In production a request left no
 * trace, so "the site was slow at 14:30" and "a user got a 500" had nothing
 * to read — the dev-only request inspector (`absolute inspect`) keeps a
 * ring buffer in memory for a running dev server, which is a different
 * tool for a different question.
 *
 * Two formats, because the two consumers are not the same. `json` is one
 * object per line for a log pipeline that parses. `text` is for a human
 * watching a terminal.
 *
 * Pure: a record in, a string out. The plugin does the timing and the
 * writing. */

import type { AccessLogFormat } from '../../types/logging';

export type AccessLogRecord = {
	durationMs: number;
	method: string;
	path: string;
	requestId: string;
	status: number;
	/** Response bytes, when the response said. */
	size?: number | null;
};

const DURATION_DECIMALS = 1;

/* A level rather than just a status, because a log pipeline filters on
 * level. 5xx is this process's fault, 4xx is the request's. */
const levelFor = (status: number) => {
	if (status >= 500) return 'error';

	return status >= 400 ? 'warn' : 'info';
};

/** The JSON form: one object per line, with a fixed key set so a pipeline
 *  can index it. `JSON.stringify` also removes the last worry about a
 *  forged line — a path or id containing a quote or a newline is escaped
 *  rather than ending the record. */
const jsonLine = (record: AccessLogRecord, timestamp: string) =>
	JSON.stringify({
		at: timestamp,
		durationMs: Number(record.durationMs.toFixed(DURATION_DECIMALS)),
		level: levelFor(record.status),
		method: record.method,
		msg: 'request',
		path: record.path,
		requestId: record.requestId,
		...(record.size === null || record.size === undefined
			? {}
			: { size: record.size }),
		status: record.status
	});

const textLine = (record: AccessLogRecord, timestamp: string) =>
	`${timestamp} ${record.method} ${record.path} ${record.status} ${record.durationMs.toFixed(DURATION_DECIMALS)}ms req=${record.requestId}`;

/** The line to write for one finished request. */
export const accessLogLine = (
	record: AccessLogRecord,
	format: AccessLogFormat,
	timestamp: string = new Date().toISOString()
) =>
	format === 'json'
		? jsonLine(record, timestamp)
		: textLine(record, timestamp);
