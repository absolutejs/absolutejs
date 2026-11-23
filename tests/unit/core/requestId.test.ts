import { describe, expect, test } from 'bun:test';
import {
	newRequestId,
	requestIdFor,
	usableRequestId
} from '../../../src/core/requestId';

/* An inbound request id is adopted so a trace spans the proxy and this
 * process, which makes it client-controlled text that lands in a log line.
 *
 * What it is not, measured before writing any of this: newline forgery is
 * unreachable. `new Request()` refuses CR, LF and NUL in a header value,
 * and sending `x-request-id: a"}<CRLF>X-Injected: yes` over a socket
 * arrives as the value `a"}` with a separate header — the HTTP parser ends
 * the value at the CRLF. The newline cases below are therefore defence in
 * depth for a non-HTTP caller, not the reason this validation exists.
 *
 * The reasons it exists all arrive intact over the wire: ANSI escapes,
 * which rewrite a terminal watching the text format; quotes, spaces and
 * tabs, which make a text line ambiguous; and length, which lets a client
 * choose how many bytes per request this process writes to disk. */

const withHeader = (value: string, name = 'x-request-id') =>
	new Request('https://app.example.com/', { headers: { [name]: value } });

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

describe('usableRequestId', () => {
	test('an id a proxy would send is adopted as-is', () => {
		expect(usableRequestId('3f8a9c2e-1b4d-4c7a-9e2f-5a6b7c8d9e0f')).toBe(
			'3f8a9c2e-1b4d-4c7a-9e2f-5a6b7c8d9e0f'
		);
		expect(usableRequestId('Root=1-67a9-b2c3d4e5f6')).toBe(
			'Root=1-67a9-b2c3d4e5f6'
		);
	});

	test('no header, or an empty one', () => {
		expect(usableRequestId(null)).toBeNull();
		expect(usableRequestId('')).toBeNull();
		expect(usableRequestId('   ')).toBeNull();
	});

	/* The forged-line cases. */
	test('a newline is refused', () => {
		expect(usableRequestId('a"}\n{"level":"info"')).toBeNull();
		expect(usableRequestId('abc\r\ndef')).toBeNull();
	});

	test('a quote is refused', () => {
		expect(usableRequestId('abc"def')).toBeNull();
		expect(usableRequestId("abc'def")).toBeNull();
	});

	/* A terminal watching `logging: { requests: 'text' }` acts on these. */
	test('an ANSI escape is refused', () => {
		expect(usableRequestId('\u001b[31mred')).toBeNull();
	});

	test('whitespace inside an id is refused', () => {
		expect(usableRequestId('two words')).toBeNull();
		expect(usableRequestId('tab\there')).toBeNull();
	});

	/* Padding every log line out with 10 KB of id is a cheap way to fill a
	 * disk, and a 10 KB header value is accepted by the runtime and the
	 * wire — measured, not assumed. */
	test('an over-long id is refused', () => {
		expect(usableRequestId('a'.repeat(96))).toBe('a'.repeat(96));
		expect(usableRequestId('a'.repeat(97))).toBeNull();
		expect(usableRequestId('a'.repeat(10240))).toBeNull();
	});

	/* AWS X-Ray's own format, which is why `=` and `;` are allowed: the
	 * first version of this pattern refused the header it documents as a
	 * supported source. */
	test('an X-Ray trace header is adopted', () => {
		expect(
			usableRequestId(
				'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1'
			)
		).toBe(
			'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1'
		);
	});

	/* A chain of proxies appends, and the client's own hop is first — the
	 * same rule `isHttpsRequest` follows for `x-forwarded-proto`. */
	test('the first value of a list is the one adopted', () => {
		expect(usableRequestId('abc123, def456')).toBe('abc123');
	});

	test('a list whose first value is unusable is refused outright', () => {
		expect(usableRequestId('bad id, good-id')).toBeNull();
	});
});

describe('requestIdFor', () => {
	test('adopts a usable inbound id', () => {
		expect(requestIdFor(withHeader('abc-123'))).toBe('abc-123');
	});

	test('mints one when the header is absent', () => {
		expect(requestIdFor(new Request('https://app.example.com/'))).toMatch(
			UUID_PATTERN
		);
	});

	/* The important half: a refused id is REPLACED, not dropped. A log line
	 * with no id is as hard to correlate as no log line.
	 *
	 * The value here is one a real request can carry — an ANSI escape. A
	 * newline cannot be used for this test because `new Request()` refuses
	 * to construct it, which is the point recorded above. */
	test('mints one when the inbound id is unusable', () => {
		expect(requestIdFor(withHeader('\u001b[31mred'))).toMatch(UUID_PATTERN);
		expect(requestIdFor(withHeader('two words'))).toMatch(UUID_PATTERN);
	});

	test('reads a configured header instead', () => {
		const request = withHeader('trace-9', 'x-amzn-trace-id');

		expect(requestIdFor(request, 'x-amzn-trace-id')).toBe('trace-9');
		/* And does not pick it up under the default name. */
		expect(requestIdFor(request)).toMatch(UUID_PATTERN);
	});
});

describe('newRequestId', () => {
	test('is a uuid, and a different one each time', () => {
		const first = newRequestId();

		expect(first).toMatch(UUID_PATTERN);
		expect(newRequestId()).not.toBe(first);
	});
});
