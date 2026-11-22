import { afterEach, describe, expect, test } from 'bun:test';
import { measureThroughput } from '../../../src/bench/load';
import { getAvailablePort } from '../../../src/testing/ports';

/* The parts of a load loop that quietly flatter the numbers if they are
 * wrong: counting the warmup, not draining the body, and treating a 500
 * as a fast response. Measured against a real local server, because a
 * stubbed `fetch` would not exercise any of them. */

let servers: { stop: () => void }[] = [];

type Handler = (request: Request) => Response | Promise<Response>;

const serve = async (fetchHandler: Handler) => {
	const port = await getAvailablePort();
	const server = Bun.serve({ fetch: fetchHandler, port });
	servers.push({ stop: () => server.stop(true) });

	return `http://localhost:${port}`;
};

afterEach(() => {
	for (const server of servers) server.stop();
	servers = [];
});

describe('measureThroughput', () => {
	test('collects samples from the measured window only', async () => {
		let served = 0;
		const url = await serve(() => {
			served += 1;

			return new Response('<h1>ok</h1>');
		});

		const { samples, windowMs } = await measureThroughput(url, {
			concurrency: 2,
			durationMs: 150,
			warmupMs: 150
		});

		expect(samples.length).toBeGreaterThan(0);
		/* The server saw more requests than were reported, because the
		 * warmup's were thrown away. Counting them makes a fast server
		 * look slow: the first requests pay for JIT and a cold module
		 * graph. */
		expect(served).toBeGreaterThan(samples.length);
		expect(windowMs).toBeGreaterThan(0);
	}, 30_000);

	test('runs the requested number in flight at once', async () => {
		let inFlight = 0;
		let peak = 0;
		const url = await serve(async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await Bun.sleep(5);
			inFlight -= 1;

			return new Response('ok');
		});

		await measureThroughput(url, {
			concurrency: 4,
			durationMs: 120,
			warmupMs: 0
		});

		/* One at a time measures latency and says nothing about
		 * throughput, which is the number this command exists to report. */
		expect(peak).toBeGreaterThan(1);
	}, 30_000);

	/* A server answering 500 in a microsecond must never read as the
	 * fastest thing measured. */
	test('a non-2xx is recorded as a failure', async () => {
		const url = await serve(() => new Response('nope', { status: 500 }));

		const { samples } = await measureThroughput(url, {
			concurrency: 1,
			durationMs: 60,
			warmupMs: 0
		});

		expect(samples.length).toBeGreaterThan(0);
		expect(samples.every((sample) => !sample.ok)).toBe(true);
	}, 30_000);

	/* The body has to be drained or the measurement stops at the headers,
	 * and a streaming render reads as instant. */
	test('waits for the whole body, not just the headers', async () => {
		const url = await serve(
			() =>
				new Response(
					new ReadableStream({
						async start(controller) {
							controller.enqueue(new TextEncoder().encode('a'));
							await Bun.sleep(25);
							controller.enqueue(new TextEncoder().encode('b'));
							controller.close();
						}
					})
				)
		);

		const { samples } = await measureThroughput(url, {
			concurrency: 1,
			durationMs: 120,
			warmupMs: 0
		});

		expect(samples.length).toBeGreaterThan(0);
		expect(samples.every((sample) => sample.ms >= 20)).toBe(true);
	}, 30_000);

	test('a server that is not there yields failures, not a hang', async () => {
		const port = await getAvailablePort();

		const { samples } = await measureThroughput(
			`http://127.0.0.1:${port}/`,
			{ concurrency: 1, durationMs: 60, warmupMs: 0 }
		);

		expect(samples.length).toBeGreaterThan(0);
		expect(samples.every((sample) => !sample.ok)).toBe(true);
	}, 30_000);
});
