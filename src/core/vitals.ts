import { Elysia, t } from 'elysia';
import { createVitalsStore } from './vitalsStore';
import type { ResolvedVitalsSummary } from '../../types/vitals';

/* The built-in endpoint for web vitals batches (see src/build/vitals.ts).
 *
 * Each metric is handed to the handlers registered with `onVital()`, for
 * your own store or @absolutejs/observability, and — when the summary
 * endpoint is on — aggregated into per-route histograms this process can
 * report on. See src/core/vitalsStore.ts for why that aggregation exists at
 * all. */

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

const SUMMARY_HEADERS = {
	/* The numbers change with every page load, and a proxy caching this
	 * would report a moment that has passed as the current one. */
	'cache-control': 'no-store',
	'content-type': 'application/json; charset=utf-8'
} as const;

export type VitalsPluginOptions = {
	/** Where the batches arrive. */
	path: string;
	/** Mounts the summary endpoint and starts aggregating. Left out,
	 *  neither happens: there is no point holding histograms nothing can
	 *  read. */
	summary?: ResolvedVitalsSummary;
};

/** POST `path`: validates a batch, records it when a summary is being kept,
 *  and passes each metric to the `onVital` handlers. Answers 204; a handler
 *  that throws is logged, not surfaced.
 *
 *  GET the summary path, when one is configured: this process's per-route
 *  p75s. */
export const createVitalsPlugin = ({ path, summary }: VitalsPluginOptions) => {
	const store =
		summary === undefined
			? undefined
			: createVitalsStore({ maxRoutes: summary.maxRoutes });

	const app = new Elysia({ name: 'absolutejs-vitals', seed: path }).post(
		path,
		{ body: vitalsBatchSchema },
		async ({ body, request, set }) => {
			const handlers = [...getHandlers()];
			await Promise.all(
				body.metrics.flatMap((metric) => {
					const report: VitalReport = {
						...metric,
						route: body.route
					};
					store?.record(report);

					return handlers.map(async (handler) => {
						try {
							await handler(report, request);
						} catch (error) {
							console.error(
								'[vitals] onVital handler failed:',
								error
							);
						}
					});
				})
			);
			set.status = 204;

			return null;
		}
	);

	if (store === undefined || summary === undefined) return app;

	return app.get(
		summary.path,
		() =>
			new Response(JSON.stringify(store.summary()), {
				headers: SUMMARY_HEADERS
			})
	);
};
