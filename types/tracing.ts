/* The tracer shape the framework calls, and nothing more.
 *
 * Deliberately a structural subset of `@absolutejs/telemetry`'s `Tracer`
 * and `Span` (which themselves type-replicate `@opentelemetry/api`), so a
 * tracer from either is assignable here and this package takes no
 * dependency on either. `@absolutejs/telemetry` is not a direct dependency
 * of this framework — it arrives transitively through `sync` and
 * `dispatch` — and a project that never traces should not acquire one.
 *
 * Span methods are declared as returning `void` even though both real
 * implementations return the span for chaining. TypeScript allows a
 * function returning a value where one returning `void` is expected, so
 * this accepts theirs while avoiding a recursive structural match between
 * their `Span` and ours. `tests/unit/core/renderTracing.test.ts` pins the
 * assignability with a copy of their published signatures. */

export type TraceAttributeValue = boolean | number | string;

export type TraceAttributes = Record<string, TraceAttributeValue | undefined>;

export type RenderSpan = {
	addEvent: (name: string, attributes?: TraceAttributes) => void;
	end: (endTime?: number) => void;
	isRecording: () => boolean;
	recordException: (exception: unknown, time?: number) => void;
	setAttribute: (key: string, value: TraceAttributeValue) => void;
	setAttributes: (attributes: TraceAttributes) => void;
	setStatus: (status: { code: number; message?: string }) => void;
};

export type RenderSpanOptions = {
	attributes?: TraceAttributes;
	kind?: number;
	root?: boolean;
	startTime?: number;
};

export type RenderTracer = {
	startActiveSpan: <Result>(
		name: string,
		options: RenderSpanOptions,
		fn: (span: RenderSpan) => Result
	) => Result;
};
