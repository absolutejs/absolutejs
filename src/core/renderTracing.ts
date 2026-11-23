/* OpenTelemetry spans for the phases of serving a page.
 *
 * Nothing timed a render at request time. `@elysia/server-timing` is
 * mounted in dev only and times Elysia's lifecycle hooks rather than the
 * render, and `ABSOLUTE_BUILD_TRACE` times the build. So "which page is
 * slow in production, and in which phase" had no answer, which is the
 * question a trace exists to answer.
 *
 * No tracer, no cost: `withRenderSpan` calls through when none is
 * registered. That is one `undefined` check on a path that already does
 * considerably more, and it means tracing is something a project opts into
 * rather than something everyone pays for.
 *
 * On the attribute names. `@absolutejs/telemetry` pins `ABS_ATTRS` so a
 * query like `abs.tenant = "acme"` resolves spans from sync, queue and
 * runtime at once, and the right home for these names is there. It has
 * none for rendering today and is not checked out beside this repo, so
 * they are defined here, in one place, in that package's style, to be
 * folded into it. Nothing else emits spans about rendering a page, so
 * there is nothing for them to collide with in the meantime — and no
 * existing `ABS_ATTRS` name fits a render, so none is reused here (the
 * shared dimensions it pins, like tenant and shard, are facts the
 * framework does not know). */

import type {
	RenderSpan,
	RenderTracer,
	TraceAttributes
} from '../../types/tracing';
import { getCurrentAbsoluteRoute } from './requestContext';

/** Render attributes, in `ABS_ATTRS` style. These belong in
 *  `@absolutejs/telemetry`; see the note above. */
export const ABS_RENDER_ATTRS = {
	/** `react`, `svelte`, `vue`, `angular`, `html`, `htmx`. */
	framework: 'abs.render.framework',
	/** The page, as the manifest names it. */
	page: 'abs.render.page',
	/** Which part of serving the page this span covers. */
	phase: 'abs.render.phase',
	/** The Elysia route pattern that matched, e.g. `/blog/:slug`. */
	route: 'abs.render.route'
} as const;

/** Values for `abs.render.phase`, so a query can ask for one part of the
 *  work across every framework. */
export type RenderPhase = 'page' | 'response' | 'island' | 'hole';

/* `SpanStatusCode.ERROR` from the OTel enum, as a literal: the whole point
 * of the structural tracer type is not importing the package that declares
 * it. */
const SPAN_STATUS_ERROR = 2;

const TRACER_KEY = Symbol.for('absolutejs.renderTracer');

/* Handed to the callback when nothing is tracing, so a handler can enrich
 * its span unconditionally instead of guarding every call. One shared
 * object: `@absolutejs/telemetry`'s own noop span is a singleton for the
 * same reason. */
const NOOP_SPAN: RenderSpan = {
	addEvent: () => undefined,
	end: () => undefined,
	isRecording: () => false,
	recordException: () => undefined,
	setAttribute: () => undefined,
	setAttributes: () => undefined,
	setStatus: () => undefined
};

const isTracer = (value: unknown): value is RenderTracer =>
	typeof value === 'object' &&
	value !== null &&
	'startActiveSpan' in value &&
	typeof value.startActiveSpan === 'function';

const getTracer = () => {
	const value = Reflect.get(globalThis, TRACER_KEY);

	return isTracer(value) ? value : undefined;
};

/** For tests and for a dev runtime that rebuilds in place. */
export const clearTracer = () => {
	Reflect.set(globalThis, TRACER_KEY, undefined);
};

/** Register the tracer the framework should emit render spans on.
 *
 *  Takes anything with OpenTelemetry's `startActiveSpan`, so
 *  `tracerOrNoop(provider, 'app')` from `@absolutejs/telemetry` or a
 *  tracer straight from `@opentelemetry/api` both work. Returns a function
 *  that unregisters it.
 *
 *  On `globalThis` behind a `Symbol.for`, like the error reporters and the
 *  health checks: the app's own bundle and the framework runtime can be
 *  separate module copies. */
export const registerTracer = (tracer: RenderTracer) => {
	Reflect.set(globalThis, TRACER_KEY, tracer);

	return () => {
		Reflect.set(globalThis, TRACER_KEY, undefined);
	};
};

type RenderSpanInput = {
	framework?: string;
	page?: string;
	phase: RenderPhase;
};

const attributesFor = ({ framework, page, phase }: RenderSpanInput) => {
	const route = getCurrentAbsoluteRoute();
	const attributes: TraceAttributes = { [ABS_RENDER_ATTRS.phase]: phase };
	if (framework !== undefined)
		attributes[ABS_RENDER_ATTRS.framework] = framework;
	if (page !== undefined) attributes[ABS_RENDER_ATTRS.page] = page;
	if (route !== undefined) attributes[ABS_RENDER_ATTRS.route] = route;

	return attributes;
};

const finish = (span: RenderSpan, error: unknown) => {
	if (error !== undefined) {
		span.recordException(error);
		span.setStatus({
			code: SPAN_STATUS_ERROR,
			message: error instanceof Error ? error.message : undefined
		});
	}
	span.end();
};

/** Run `fn` inside a span, or just run it when nothing is tracing.
 *
 *  An error is recorded on the span and re-thrown: the span says the
 *  render failed, and the caller's own error handling — which renders the
 *  error convention — is unchanged. Swallowing it here would turn a
 *  failed page into a blank one. */
export const withRenderSpan = async <Result>(
	name: string,
	input: RenderSpanInput,
	run: (span: RenderSpan) => Promise<Result>
) => {
	const tracer = getTracer();
	if (tracer === undefined) return run(NOOP_SPAN);

	return tracer.startActiveSpan(
		name,
		{ attributes: attributesFor(input) },
		async (span) => {
			try {
				const result = await run(span);
				finish(span, undefined);

				return result;
			} catch (error) {
				finish(span, error);
				throw error;
			}
		}
	);
};
