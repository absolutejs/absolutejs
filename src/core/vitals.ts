import { Elysia, t } from 'elysia';

/* The built-in endpoint for web vitals batches (see src/build/vitals.ts).
 * Nothing is stored: each metric is handed to the handlers registered with
 * `onVital()`, for your own store or @absolutejs/observability. */

export type VitalName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

export type VitalReport = {
	delta?: number;
	/** Unique per metric instance and page load (web-vitals' `id`). */
	id: string;
	name: VitalName;
	navigationType?: string;
	rating?: 'good' | 'needs-improvement' | 'poor';
	/** The page's path when it loaded. */
	route: string;
	value: number;
};

export type VitalHandler = (
	report: VitalReport,
	request: Request
) => void | Promise<void>;

const HANDLERS_KEY = Symbol.for('absolutejs.vitalHandlers');

/* One registry per process: dist/index.js and the framework entries each
 * carry a copy of this module. */
const getHandlers = () => {
	const existing: unknown = Reflect.get(globalThis, HANDLERS_KEY);
	if (existing instanceof Set) return existing;
	const created = new Set<VitalHandler>();
	Reflect.set(globalThis, HANDLERS_KEY, created);

	return created;
};

/** Receives every web vital the built-in endpoint accepts. Returns a
 *  function that removes the handler. */
export const onVital = (handler: VitalHandler) => {
	const handlers = getHandlers();
	handlers.add(handler);

	return () => {
		handlers.delete(handler);
	};
};

const MAX_METRICS = 10;

export const vitalsBatchSchema = t.Object({
	metrics: t.Array(
		t.Object({
			delta: t.Optional(t.Number()),
			id: t.String({ maxLength: 200 }),
			name: t.Union([
				t.Literal('CLS'),
				t.Literal('FCP'),
				t.Literal('INP'),
				t.Literal('LCP'),
				t.Literal('TTFB')
			]),
			navigationType: t.Optional(t.String({ maxLength: 40 })),
			rating: t.Optional(
				t.Union([
					t.Literal('good'),
					t.Literal('needs-improvement'),
					t.Literal('poor')
				])
			),
			value: t.Number({ minimum: 0 })
		}),
		{ maxItems: MAX_METRICS }
	),
	navigationType: t.Optional(t.String({ maxLength: 40 })),
	route: t.String({ maxLength: 2048 })
});

/** POST `path`: validates a batch and passes each metric to the `onVital`
 *  handlers. Answers 204; a handler that throws is logged, not surfaced. */
export const createVitalsPlugin = (path: string) =>
	new Elysia({ name: 'absolutejs-vitals', seed: path }).post(
		path,
		{ body: vitalsBatchSchema },
		async ({ body, request, set }) => {
			const handlers = [...getHandlers()];
			await Promise.all(
				body.metrics.flatMap((metric) =>
					handlers.map(async (handler) => {
						try {
							await handler(
								{ ...metric, route: body.route },
								request
							);
						} catch (error) {
							console.error(
								'[vitals] onVital handler failed:',
								error
							);
						}
					})
				)
			);
			set.status = 204;

			return null;
		}
	);
