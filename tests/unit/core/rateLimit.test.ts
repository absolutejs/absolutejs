import { describe, expect, test } from 'bun:test';
import { clientKeyFor, createRateLimiter } from '../../../src/core/rateLimit';

/* The two things that make a limiter real rather than decorative: what it
 * counts by, and what stops its own store from being the exhaustion
 * vector. The window arithmetic is the easy part. */

const atClock = (start = 0) => {
	let current = start;

	return {
		advance: (ms: number) => {
			current += ms;
		},
		now: () => current
	};
};

describe('createRateLimiter', () => {
	test('allows up to the limit, then refuses', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 3,
			now: clock.now,
			windowMs: 1000
		});

		expect(limiter.check('a1').allowed).toBe(true);
		expect(limiter.check('a1').allowed).toBe(true);
		expect(limiter.check('a1').remaining).toBe(0);
		expect(limiter.check('a1').allowed).toBe(false);
	});

	test('reports what a client needs to back off', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 1,
			now: clock.now,
			windowMs: 60_000
		});

		limiter.check('a1');
		const refused = limiter.check('a1');

		expect(refused).toEqual({
			allowed: false,
			limit: 1,
			remaining: 0,
			resetSeconds: 60
		});
	});

	/* Rounded up and never zero: `Retry-After: 0` tells a client to retry
	 * immediately, which is the opposite of the instruction. */
	test('the reset is always at least a second', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 1,
			now: clock.now,
			windowMs: 1000
		});

		limiter.check('a1');
		clock.advance(999);

		expect(limiter.check('a1').resetSeconds).toBe(1);
	});

	test('a new window restores the allowance', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 2,
			now: clock.now,
			windowMs: 1000
		});

		limiter.check('a1');
		limiter.check('a1');

		expect(limiter.check('a1').allowed).toBe(false);

		clock.advance(1001);

		expect(limiter.check('a1').allowed).toBe(true);
	});

	test('keys are counted separately', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 1,
			now: clock.now,
			windowMs: 1000
		});

		expect(limiter.check('a1').allowed).toBe(true);
		expect(limiter.check('b2').allowed).toBe(true);
		expect(limiter.check('a1').allowed).toBe(false);
	});

	/* Blocked requests keep counting, so a client hammering a refused
	 * endpoint does not walk back under the limit by being refused. */
	test('refused requests still count', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 1,
			now: clock.now,
			windowMs: 1000
		});

		limiter.check('a1');
		limiter.check('a1');
		limiter.check('a1');
		clock.advance(500);

		expect(limiter.check('a1').allowed).toBe(false);
	});
});

describe('the store is bounded', () => {
	/* The point of the cap. An attacker chooses the keys — a botnet, or a
	 * spoofed `x-forwarded-for` behind `trustProxy` — so without this the
	 * limiter becomes the memory-exhaustion vector it was added to
	 * prevent. */
	test('rotating keys cannot grow the store past the cap', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 10,
			maxKeys: 50,
			now: clock.now,
			windowMs: 60_000
		});

		for (let index = 0; index < 5000; index += 1)
			limiter.check(`key-${index}`);

		expect(limiter.size()).toBeLessThanOrEqual(50);
	});

	/* Eviction takes the key untouched for longest, so a client still
	 * sending traffic keeps its bucket and does not get a fresh allowance
	 * by being evicted. Without the delete-then-set on each hit, `busy`
	 * below would be evicted as the oldest INSERT and come back unlimited. */
	test('the least recently seen key is evicted, not the oldest inserted', () => {
		const clock = atClock();
		const limiter = createRateLimiter({
			limit: 1,
			maxKeys: 2,
			now: clock.now,
			windowMs: 60_000
		});

		limiter.check('busy');
		limiter.check('idle');
		/* `busy` is seen again, so `idle` is now the least recently seen. */
		clock.advance(10);
		limiter.check('busy');
		/* Over the cap: something has to go, and it should be `idle`. */
		limiter.check('newcomer');

		expect(limiter.check('busy').allowed).toBe(false);
	});
});

describe('clientKeyFor', () => {
	const forwarded = (value: string) =>
		new Request('http://app.test/', {
			headers: { 'x-forwarded-for': value }
		});

	/* The default. A key the client picks is not a key: trusting this
	 * header by default would mean a fresh value per request gets a fresh
	 * bucket per request, and every limit becomes decoration. */
	test('the connection address is used and the header ignored', () => {
		expect(clientKeyFor(forwarded('203.0.113.7'), '10.0.0.2')).toBe(
			'10.0.0.2'
		);
	});

	test('trustProxy opts into the forwarded client hop', () => {
		expect(clientKeyFor(forwarded('203.0.113.7'), '10.0.0.2', true)).toBe(
			'203.0.113.7'
		);
	});

	/* A CDN in front of a load balancer sends `client, proxy1`; the client
	 * is first, as with `x-forwarded-proto`. */
	test('the first hop is the client', () => {
		expect(
			clientKeyFor(forwarded('203.0.113.7, 10.0.0.1'), '10.0.0.2', true)
		).toBe('203.0.113.7');
	});

	test('trustProxy with no header falls back to the connection', () => {
		expect(
			clientKeyFor(new Request('http://app.test/'), '10.0.0.2', true)
		).toBe('10.0.0.2');
	});

	/* An empty header must not become the key, or every request carrying
	 * one shares a single bucket and limits each other. */
	test('an empty forwarded value falls back to the connection', () => {
		expect(clientKeyFor(forwarded('  '), '10.0.0.2', true)).toBe(
			'10.0.0.2'
		);
	});

	/* Unix sockets and odd runtimes have no address. One shared bucket is
	 * the safe answer: it limits rather than exempts. */
	test('no address at all is still a key', () => {
		expect(clientKeyFor(new Request('http://app.test/'), undefined)).toBe(
			'unknown'
		);
	});
});
