import { afterEach, describe, expect, test } from 'bun:test';
import {
	clearServerErrorReporters,
	onServerError,
	reportServerError
} from '../../../src/core/errorReporter';
import { runWithAbsoluteRequest } from '../../../src/core/requestContext';
import type { ServerErrorReport } from '../../../types/errorReport';

/* A reporter runs inside a `catch` that is already handling a failed
 * render, which is what makes its isolation the whole job here. Three
 * things it must not be able to do:
 *
 *  - Break the request: a throw there would replace an error page with a
 *    crash.
 *  - Delay the response: a reporter posting to an API returns a promise,
 *    and awaiting it would hold the error page behind a network round
 *    trip.
 *  - Loop: a reporter's own failure reported through the reporters is how
 *    a stack overflow gets written. */

afterEach(() => {
	clearServerErrorReporters();
});

const collect = () => {
	const seen: ServerErrorReport[] = [];
	onServerError((report) => {
		seen.push(report);
	});

	return seen;
};

describe('onServerError', () => {
	test('a reporter sees the report', () => {
		const seen = collect();
		const error = new Error('render failed');
		reportServerError({ error, framework: 'react', kind: 'page' });

		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			error,
			framework: 'react',
			kind: 'page'
		});
	});

	test('every reporter sees it', () => {
		const first = collect();
		const second = collect();
		reportServerError({ error: new Error('x'), kind: 'page' });

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
	});

	test('the returned function removes it', () => {
		const seen: ServerErrorReport[] = [];
		const remove = onServerError((report) => {
			seen.push(report);
		});
		remove();
		reportServerError({ error: new Error('x'), kind: 'page' });

		expect(seen).toEqual([]);
	});

	/* Nothing registered is the default, and has to stay free: this runs on
	 * every render error. */
	test('reporting with no reporters registered does nothing', () => {
		expect(() =>
			reportServerError({ error: new Error('x'), kind: 'page' })
		).not.toThrow();
	});
});

describe('a misbehaving reporter', () => {
	/* The one that matters: the error page must still be produced. */
	test('a throwing reporter does not break reporting', () => {
		onServerError(() => {
			throw new Error('reporter is broken');
		});
		const seen = collect();

		expect(() =>
			reportServerError({ error: new Error('x'), kind: 'page' })
		).not.toThrow();
		/* And the reporters after it still ran. */
		expect(seen).toHaveLength(1);
	});

	test('a rejecting reporter does not become an unhandled rejection', async () => {
		onServerError(async () => {
			await Bun.sleep(1);
			throw new Error('post failed');
		});
		const seen = collect();
		reportServerError({ error: new Error('x'), kind: 'page' });
		await Bun.sleep(20);

		expect(seen).toHaveLength(1);
	});

	/* `reportServerError` returns before a slow reporter finishes: the
	 * response does not wait for the network. */
	test('a slow reporter is not awaited', () => {
		let finished = false;
		onServerError(async () => {
			await Bun.sleep(50);
			finished = true;
		});
		reportServerError({ error: new Error('x'), kind: 'page' });

		expect(finished).toBe(false);
	});

	/* A reporter's own failure must not be reported through the reporters.
	 * If it were, this reporter — which throws on every call — would
	 * recurse until the stack ran out. */
	test('a reporter failing is not itself reported to the reporters', () => {
		let calls = 0;
		onServerError(() => {
			calls += 1;
			throw new Error('always throws');
		});
		reportServerError({ error: new Error('x'), kind: 'page' });

		expect(calls).toBe(1);
	});
});

describe('the report', () => {
	/* The payoff of the correlation id: an error in a reporter's inbox and
	 * a line in the access log can be matched up. */
	test('carries the request it happened in', () => {
		const seen = collect();
		runWithAbsoluteRequest(
			new Request('https://app.test/checkout?step=2', {
				method: 'POST'
			}),
			() => {
				reportServerError({ error: new Error('x'), kind: 'page' });
			}
		);

		expect(seen[0]).toMatchObject({
			method: 'POST',
			path: '/checkout'
		});
		expect((seen[0]?.requestId ?? '').length).toBeGreaterThan(0);
	});

	/* A query string can carry a session token or an email. The path is
	 * enough to say which route failed. */
	test('does not carry the query string', () => {
		const seen = collect();
		runWithAbsoluteRequest(
			new Request('https://app.test/reset?token=secret-value'),
			() => {
				reportServerError({ error: new Error('x'), kind: 'page' });
			}
		);

		expect(JSON.stringify(seen[0])).not.toContain('secret-value');
	});

	/* Build-time and boot-time errors have no request. */
	test('works outside a request', () => {
		const seen = collect();
		reportServerError({ error: new Error('x'), kind: 'load' });

		expect(seen[0]).toMatchObject({ kind: 'load' });
		expect(seen[0]?.requestId).toBeUndefined();
		expect(seen[0]?.path).toBeUndefined();
	});
});

/* One site end to end, so the wiring is covered and not just the reporter.
 *
 * `handleHTMLPageRequest` on a path that does not exist takes the same
 * `catch` a real page error takes: it renders the error convention and
 * reports. The static handler is the one of the nine sites reachable
 * without a built bundle, which is why it is the one tested here. */
describe('the page handlers report', () => {
	test('a static page that cannot be read is reported', async () => {
		const { handleHTMLPageRequest } =
			await import('../../../src/core/pageHandlers');
		const seen = collect();
		const response = await handleHTMLPageRequest(
			'/does/not/exist/Checkout.html'
		);

		/* The visitor still gets an error page, which is the behaviour the
		 * reporter must not have changed. */
		expect(response.status).toBe(500);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			framework: 'html',
			kind: 'page',
			page: 'Checkout'
		});
		expect(seen[0]?.error).toBeDefined();
	});
});
