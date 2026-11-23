import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
	ABS_RENDER_ATTRS,
	clearTracer,
	registerTracer,
	withRenderSpan
} from '../../../src/core/renderTracing';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import type {
	RenderSpan,
	RenderTracer,
	TraceAttributes
} from '../../../types/tracing';

/* Spans for render phases, on a tracer the app supplies.
 *
 * The framework takes no dependency on `@absolutejs/telemetry` or
 * `@opentelemetry/api` — the tracer type here is a structural subset of
 * both — so the first thing worth pinning is that a real tracer is
 * actually assignable to it. The rest is: a project with no tracer pays
 * nothing, a failed render marks its span and still throws, and the
 * attributes are the ones a query would filter on. */

type RecordedSpan = {
	attributes: TraceAttributes;
	ended: boolean;
	exceptions: unknown[];
	name: string;
	status?: { code: number; message?: string };
};

const fakeTracer = () => {
	const spans: RecordedSpan[] = [];
	const tracer: RenderTracer = {
		startActiveSpan: (name, options, fn) => {
			const recorded: RecordedSpan = {
				attributes: { ...options.attributes },
				ended: false,
				exceptions: [],
				name
			};
			spans.push(recorded);
			const span: RenderSpan = {
				addEvent: () => undefined,
				end: () => {
					recorded.ended = true;
				},
				isRecording: () => true,
				recordException: (exception) => {
					recorded.exceptions.push(exception);
				},
				setAttribute: (key, value) => {
					recorded.attributes[key] = value;
				},
				setAttributes: (attributes) => {
					Object.assign(recorded.attributes, attributes);
				},
				setStatus: (status) => {
					recorded.status = status;
				}
			};

			return fn(span);
		}
	};
	registerTracer(tracer);

	return spans;
};

afterEach(() => {
	clearTracer();
});

describe('with no tracer registered', () => {
	/* The default, and it has to cost nothing: this wraps every page
	 * render and every HTML response. */
	test('the work still runs and the result passes through', async () => {
		const result = await withRenderSpan(
			'render.page',
			{ phase: 'page' },
			async () => 'rendered'
		);

		expect(result).toBe('rendered');
	});

	test('a throw is not swallowed', async () => {
		const failing = withRenderSpan(
			'render.page',
			{ phase: 'page' },
			async () => {
				throw new Error('render failed');
			}
		);

		await expect(failing).rejects.toThrow('render failed');
	});

	/* The callback gets a noop span rather than `undefined`, so a handler
	 * can name its page unconditionally instead of guarding every call. */
	test('the callback can still use its span', async () => {
		const result = await withRenderSpan(
			'render.page',
			{ phase: 'page' },
			async (span) => {
				span.setAttribute(ABS_RENDER_ATTRS.page, 'Checkout');

				return span.isRecording();
			}
		);

		expect(result).toBe(false);
	});
});

describe('with a tracer', () => {
	test('a span is opened, attributed and ended', async () => {
		const spans = fakeTracer();
		await withRenderSpan(
			'render.page',
			{ framework: 'react', phase: 'page' },
			async (span) => {
				span.setAttribute(ABS_RENDER_ATTRS.page, 'Checkout');

				return 'html';
			}
		);

		expect(spans).toHaveLength(1);
		expect(spans[0]?.name).toBe('render.page');
		expect(spans[0]?.ended).toBe(true);
		expect(spans[0]?.attributes).toEqual({
			'abs.render.framework': 'react',
			'abs.render.page': 'Checkout',
			'abs.render.phase': 'page'
		});
	});

	/* A span that is never ended is a span that never arrives, so the
	 * failure path has to end it too — and the error has to keep
	 * propagating, or a failed page becomes a blank one. */
	test('a failed render records the exception, ends, and rethrows', async () => {
		const spans = fakeTracer();
		const error = new Error('render failed');
		const failing = withRenderSpan(
			'render.page',
			{ framework: 'vue', phase: 'page' },
			async () => {
				throw error;
			}
		);

		await expect(failing).rejects.toThrow('render failed');
		expect(spans[0]?.exceptions).toEqual([error]);
		expect(spans[0]?.status).toEqual({
			code: 2,
			message: 'render failed'
		});
		expect(spans[0]?.ended).toBe(true);
	});

	/* The matched route PATTERN, not the URL: a dynamic route renders many
	 * pages and `/blog/:slug` is what a dashboard groups by, while
	 * `/blog/hello` would be one row per post. Through a real Elysia app,
	 * because the pattern is put on the request context by the framework's
	 * own `onBeforeHandle` hook — asserting it any other way would be
	 * asserting the test's own setup. */
	test('the matched route pattern is attached', async () => {
		const spans = fakeTracer();
		const app = new Elysia()
			.use(absoluteRequestContext)
			.get('/blog/:slug', () =>
				withRenderSpan(
					'render.page',
					{ phase: 'page' },
					async () => 'ok'
				)
			);

		const response = await app.handle(
			new Request('http://app.test/blog/hello')
		);

		expect(response.status).toBe(200);
		expect(spans[0]?.attributes['abs.render.route']).toBe('/blog/:slug');
	});
});

describe('the tracer type', () => {
	/* The compatibility claim, pinned with a copy of the published
	 * signatures from `@absolutejs/telemetry`'s `.d.ts` (which itself
	 * type-replicates `@opentelemetry/api`). If a future edit to
	 * `types/tracing.ts` asks for more than a real tracer provides — a
	 * span method returning our own `RenderSpan`, say — this stops
	 * compiling, which is the only way to notice without taking the
	 * dependency. */
	test('a telemetry-shaped tracer is assignable', () => {
		type TheirSpan = {
			spanContext(): { spanId: string; traceId: string };
			setAttribute(
				key: string,
				value: string | number | boolean
			): TheirSpan;
			setAttributes(attrs: Record<string, unknown>): TheirSpan;
			setStatus(status: { code: number; message?: string }): TheirSpan;
			updateName(name: string): TheirSpan;
			addEvent(
				name: string,
				attrs?: Record<string, unknown>,
				time?: number
			): TheirSpan;
			recordException(exception: unknown, time?: number): void;
			isRecording(): boolean;
			end(endTime?: number): void;
		};
		type TheirTracer = {
			startSpan(
				name: string,
				options?: Record<string, unknown>
			): TheirSpan;
			startActiveSpan<T>(name: string, fn: (span: TheirSpan) => T): T;
			startActiveSpan<T>(
				name: string,
				options: Record<string, unknown>,
				fn: (span: TheirSpan) => T
			): T;
		};

		const theirs = {
			startActiveSpan: (_name: string, ...rest: unknown[]) => {
				const fn = rest.at(-1);
				if (typeof fn !== 'function')
					throw new Error('no callback given');

				return fn(span);
			},
			startSpan: () => span
		} as TheirTracer;
		const span: TheirSpan = {
			addEvent: () => span,
			end: () => undefined,
			isRecording: () => true,
			recordException: () => undefined,
			setAttribute: () => span,
			setAttributes: () => span,
			setStatus: () => span,
			spanContext: () => ({ spanId: 's', traceId: 't' }),
			updateName: () => span
		};

		const asOurs: RenderTracer = theirs;

		expect(typeof asOurs.startActiveSpan).toBe('function');
	});
});
