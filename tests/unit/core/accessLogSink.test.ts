import { describe, expect, spyOn, test } from 'bun:test';
import { createAccessLogSink } from '../../../src/core/accessLogSink';

/* The sink batches, because a write per request is most of what an access
 * log costs: measured in the same bare server, 15.8µs per request for a
 * write per line against 4.7µs batched (and `console.log` and
 * `process.stdout.write` cost the same as each other, so the call is not
 * the issue — the write is).
 *
 * Batching is only correct if nothing is lost, which is what these are
 * about: every line comes out, in order, exactly once. */

/* An interval no test waits out, and one nothing else in the process
 * would pass to `setTimeout`, so the sink's timers can be told apart. */
const UNREACHED_INTERVAL_MS = 987_654;

const collector = () => {
	const written: string[] = [];

	return {
		lines: () => written.join('').split('\n').filter(Boolean),
		write: (text: string) => {
			written.push(text);
		},
		writes: () => written.length
	};
};

describe('createAccessLogSink', () => {
	test('holds lines until the buffer fills, then writes once', () => {
		const sink_ = collector();
		const sink = createAccessLogSink({
			bufferLimit: 3,
			write: sink_.write
		});

		sink.emit('one');
		sink.emit('two');

		expect(sink_.writes()).toBe(0);

		sink.emit('three');

		/* One write, not three — the whole point. */
		expect(sink_.writes()).toBe(1);
		expect(sink_.lines()).toEqual(['one', 'two', 'three']);
	});

	test('flush writes what is held', () => {
		const sink_ = collector();
		const sink = createAccessLogSink({
			bufferLimit: 100,
			write: sink_.write
		});

		sink.emit('one');
		sink.emit('two');
		sink.flush();

		expect(sink_.lines()).toEqual(['one', 'two']);
	});

	/* What the exit hook calls into. Flushing an empty sink must not write
	 * an empty string: a stray write to a log pipeline is a parse error at
	 * the other end. */
	test('flushing nothing writes nothing', () => {
		const sink_ = collector();
		const sink = createAccessLogSink({ write: sink_.write });

		sink.flush();
		sink.flush();

		expect(sink_.writes()).toBe(0);
	});

	test('nothing is written twice', () => {
		const sink_ = collector();
		const sink = createAccessLogSink({
			bufferLimit: 2,
			write: sink_.write
		});

		sink.emit('one');
		sink.emit('two');
		sink.flush();
		sink.flush();

		expect(sink_.lines()).toEqual(['one', 'two']);
	});

	test('a line waiting on the timer is written when it fires', async () => {
		const sink_ = collector();
		const sink = createAccessLogSink({
			bufferLimit: 100,
			flushIntervalMs: 10,
			write: sink_.write
		});

		sink.emit('one');

		expect(sink_.writes()).toBe(0);

		await Bun.sleep(40);

		expect(sink_.lines()).toEqual(['one']);
	});

	/* The timer must not be re-armed per line, or a busy server schedules
	 * one timeout per request.
	 *
	 * Counted, not timed. This used to sleep 15ms twice against a 20ms
	 * timer and look at what had been written at 30ms, which left 5ms for
	 * the first sleep to overrun — and on a loaded CI runner it did, so
	 * the timer fired between the two lines and the test failed on a
	 * commit that had not touched it. */
	test('the pending timer is not re-armed by each line', () => {
		const sink_ = collector();
		const armed = spyOn(globalThis, 'setTimeout');
		const sink = createAccessLogSink({
			bufferLimit: 100,
			flushIntervalMs: UNREACHED_INTERVAL_MS,
			write: sink_.write
		});

		sink.emit('one');
		sink.emit('two');
		sink.emit('three');
		const timers = armed.mock.calls.filter(
			([, delay]) => delay === UNREACHED_INTERVAL_MS
		).length;
		armed.mockRestore();

		expect(timers).toBe(1);

		/* And that one timer covers every line held when it was armed. */
		sink.flush();

		expect(sink_.lines()).toEqual(['one', 'two', 'three']);
		expect(sink_.writes()).toBe(1);
	});

	/* The other half: once the held lines are written, the next line arms
	 * a timer of its own rather than waiting on one that is gone. */
	test('a line after a flush arms a new timer', () => {
		const sink_ = collector();
		const armed = spyOn(globalThis, 'setTimeout');
		const sink = createAccessLogSink({
			bufferLimit: 100,
			flushIntervalMs: UNREACHED_INTERVAL_MS,
			write: sink_.write
		});

		sink.emit('one');
		sink.flush();
		sink.emit('two');
		const timers = armed.mock.calls.filter(
			([, delay]) => delay === UNREACHED_INTERVAL_MS
		).length;
		armed.mockRestore();
		sink.flush();

		expect(timers).toBe(2);
		expect(sink_.writes()).toBe(2);
	});

	test('flushEachLine writes immediately, one write per line', () => {
		const sink_ = collector();
		const sink = createAccessLogSink({
			flushEachLine: true,
			write: sink_.write
		});

		sink.emit('one');

		expect(sink_.lines()).toEqual(['one']);

		sink.emit('two');

		expect(sink_.writes()).toBe(2);
		expect(sink_.lines()).toEqual(['one', 'two']);
	});

	test('every line ends with a newline', () => {
		const sink_ = collector();
		const batched = createAccessLogSink({
			bufferLimit: 2,
			write: sink_.write
		});

		batched.emit('one');
		batched.emit('two');

		const immediate = createAccessLogSink({
			flushEachLine: true,
			write: sink_.write
		});
		immediate.emit('three');

		expect(sink_.writes()).toBe(2);
		expect(sink_.lines()).toEqual(['one', 'two', 'three']);
	});
});
