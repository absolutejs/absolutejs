/* Somewhere to send server-side errors other than the terminal.
 *
 * Every render error in this framework ended at `console.error`. On a
 * server that is a line in a log nobody reads and nothing to page anyone
 * with — the error is known to the process and to no one else. There was
 * no way to hand it to Sentry, or to a database, or to anything.
 *
 * `onServerError` registers a reporter; the framework calls it from the
 * nine places an error surfaces (each framework's page handler, the
 * streaming paths, static pages, partial-prerender holes, file-route
 * `load`), with the request's correlation id attached so a report lines up
 * with the access log line for the same request.
 *
 * `console.error` still happens. A reporter is additive, not a
 * replacement: the terminal is where someone running the thing locally
 * looks, and a framework that goes quiet because a reporter was registered
 * has traded one blind spot for another.
 *
 * Three things a reporter must not be able to do, which is most of what
 * this module is:
 *
 *  - Break the request. It runs inside a `catch` that is already handling
 *    a failure; a reporter that throws there would replace an error page
 *    with a crash. Each call is isolated.
 *  - Delay the response. A reporter that posts to an API returns a
 *    promise, and awaiting it would hold the error page behind a network
 *    round trip. Promises are not awaited, only their rejections caught.
 *  - Loop. A reporter failing is itself an error, and reporting that
 *    through the same reporters is how a stack overflow gets written. A
 *    reporter's own failure goes to the terminal and no further. */

import {
	getCurrentAbsoluteRequest,
	getCurrentRequestId
} from './requestContext';
import type {
	ServerErrorReport,
	ServerErrorReporter
} from '../../types/errorReport';

const REPORTERS_KEY = Symbol.for('absolutejs.serverErrorReporters');

const isReporterSet = (value: unknown): value is Set<ServerErrorReporter> =>
	value instanceof Set;

const getReporters = () => {
	const existing = Reflect.get(globalThis, REPORTERS_KEY);
	if (isReporterSet(existing)) return existing;
	const reporters = new Set<ServerErrorReporter>();
	Reflect.set(globalThis, REPORTERS_KEY, reporters);

	return reporters;
};

/** Register a reporter. Returns a function that removes it.
 *
 *  On `globalThis` behind a `Symbol.for`, like the health checks and the
 *  request context: an app's own bundle and the framework runtime can be
 *  separate module copies, and a reporter registered through one has to be
 *  reached by the other. */
export const onServerError = (reporter: ServerErrorReporter) => {
	const reporters = getReporters();
	reporters.add(reporter);

	return () => {
		reporters.delete(reporter);
	};
};

const reporterFailed = (error: unknown) => {
	/* Deliberately the terminal and not the reporters: a reporter's own
	 * failure reported through the reporters is unbounded recursion. */
	console.error('[absolute] an error reporter threw:', error);
};

const notify = (reporter: ServerErrorReporter, report: ServerErrorReport) => {
	try {
		const result = reporter(report);
		if (result instanceof Promise) result.catch(reporterFailed);
	} catch (error) {
		reporterFailed(error);
	}
};

/** For tests and for a dev runtime that rebuilds in place. */
export const clearServerErrorReporters = () => {
	getReporters().clear();
};

/** Hand an error to every registered reporter, filling in what the current
 *  request knows. Never throws and never awaits. */
export const reportServerError = (
	report: Omit<ServerErrorReport, 'method' | 'path' | 'requestId'>
) => {
	const reporters = getReporters();
	if (reporters.size === 0) return;

	const request = getCurrentAbsoluteRequest();
	const full: ServerErrorReport = {
		...report,
		...(request === undefined
			? {}
			: { method: request.method, path: new URL(request.url).pathname }),
		...(getCurrentRequestId() === undefined
			? {}
			: { requestId: getCurrentRequestId() })
	};

	for (const reporter of reporters) notify(reporter, full);
};
