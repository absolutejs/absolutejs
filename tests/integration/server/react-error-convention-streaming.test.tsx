import { afterEach, describe, expect, test } from 'bun:test';
import { Suspense } from 'react';
import { handleReactPageRequest } from '../../../src/react/pageHandler';
import { setConventions } from '../../../src/utils/resolveConvention';

/* Adding an `error` convention must not turn streaming off.
 *
 * `src/react/pageHandler.ts` buffered the whole document — `await new
 * Response(stream).text()` — whenever an error convention existed for the
 * page or the app, so a page that streamed its shell in milliseconds
 * started arriving only once its slowest boundary had resolved. Nothing
 * said so: adding `error.tsx` is an unrelated-looking act, and the only
 * symptom is a page that got slower.
 *
 * The buffering was there so the handler's `catch` could answer with the
 * convention's error page instead of half a document. But the only error
 * that CAN be answered that way is one in the shell, and
 * `renderToReadableStream` already rejects for those before a byte is
 * written. An error after the shell is React's to report through a
 * boundary, buffered or not — the page is already committed.
 *
 * Measured by time to first byte against a page whose boundary resolves
 * after a delay, which is the only way to tell a streamed response from a
 * buffered one from the outside. */

const BOUNDARY_DELAY_MS = 600;
const STREAM_BUDGET_MS = 400;

const slowPromise = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, BOUNDARY_DELAY_MS);
	});

/* A child that suspends. Rendered inside `<Suspense>`, so the shell is
 * complete before it resolves — which is exactly the shape that makes
 * streaming visible. */
const Slow = async () => {
	await slowPromise();

	return <p id="slow">slow</p>;
};

const SlowPage = () => (
	<html lang="en">
		<head>
			<title>Slow page</title>
		</head>
		<body>
			<div id="shell">shell</div>
			<Suspense fallback={<p id="pending">pending</p>}>
				<Slow />
			</Suspense>
		</body>
	</html>
);

const ShellThrows = () => {
	throw new Error('shell exploded');
};

const ThrowingPage = () => (
	<html lang="en">
		<head>
			<title>Throwing page</title>
		</head>
		<body>
			<ShellThrows />
		</body>
	</html>
);

const withErrorConvention = () => {
	setConventions({
		react: {
			defaults: { error: 'react/error.tsx' },
			pages: {}
		}
	});
};

afterEach(() => {
	setConventions({});
});

/** Milliseconds from ASKING for the page until its first body byte, and
 *  the full text.
 *
 *  The clock has to start before the handler is called, not after it
 *  returns: a buffered handler spends the whole render inside that call
 *  and then hands back a complete body, so a clock started afterwards
 *  reads a few milliseconds either way and cannot tell the two apart.
 *  The first version of this test did that and passed against the defect
 *  it was written for. */
const timeToFirstByte = async (render: () => Promise<Response>) => {
	const started = Date.now();
	const response = await render();
	const reader = response.body?.getReader();
	if (!reader) throw new Error('response has no body');
	const decoder = new TextDecoder();
	let firstChunkAt: number | undefined;
	const chunks: string[] = [];
	/* Reading a stream is sequential by definition — each chunk has to be
	 * consumed before the next can arrive — so the awaits are in a
	 * recursive step rather than a loop. */
	const drain = async (): Promise<string[]> => {
		const chunk = await reader.read();
		if (chunk.done) return chunks;
		firstChunkAt ??= Date.now() - started;
		chunks.push(decoder.decode(chunk.value, { stream: true }));

		return drain();
	};
	await drain();

	return {
		firstChunkAt: firstChunkAt ?? Date.now() - started,
		text: chunks.join('')
	};
};

const renderSlowPage = () =>
	handleReactPageRequest({
		index: '/react/indexes/SlowPage.js',
		Page: SlowPage,
		request: new Request('http://absolute.test/slow')
	});

describe('a React page with a slow boundary', () => {
	test('streams its shell before the boundary resolves', async () => {
		/* The control. Without this, the test below could pass on a
		 * machine where everything is fast enough to look like streaming. */
		const { firstChunkAt, text } = await timeToFirstByte(renderSlowPage);

		expect(firstChunkAt).toBeLessThan(STREAM_BUDGET_MS);
		expect(text).toContain('id="shell"');
		expect(text).toContain('id="slow"');
	});

	test('still streams when an error convention exists', async () => {
		/* The defect: this page arrived only after its slowest boundary
		 * had resolved, because an error convention existed somewhere in
		 * the app. */
		withErrorConvention();
		const { firstChunkAt, text } = await timeToFirstByte(renderSlowPage);

		expect(firstChunkAt).toBeLessThan(STREAM_BUDGET_MS);
		expect(text).toContain('id="shell"');
		expect(text).toContain('id="slow"');
	});
});

describe('an error in the shell', () => {
	test('is still answered with a 500, not a half-written page', async () => {
		/* What the buffering was for, and what streaming does not cost:
		 * `renderToReadableStream` rejects for a shell error before any
		 * byte is written, so the handler's catch still gets to answer.
		 * Asserted with no convention registered, so the answer is the
		 * framework's own error page rather than a fixture's. */
		const response = await handleReactPageRequest({
			index: '/react/indexes/ThrowingPage.js',
			Page: ThrowingPage,
			request: new Request('http://absolute.test/throws')
		});

		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain('id="shell"');
	});

	test('is answered the same way with an error convention present', async () => {
		withErrorConvention();
		const response = await handleReactPageRequest({
			index: '/react/indexes/ThrowingPage.js',
			Page: ThrowingPage,
			request: new Request('http://absolute.test/throws')
		});

		// The convention file does not exist on disk in this fixture, so the
		// handler falls back to its own page — the status is the claim here.
		expect(response.status).toBe(500);
	});
});
