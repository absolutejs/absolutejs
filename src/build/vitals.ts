import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { VITAL_THRESHOLDS } from '../core/vitalsStore';
import type { VitalsConfig } from '../../types/build';
import type { ResolvedVitalsSummary } from '../../types/vitals';

/* Opt-in Core Web Vitals reporting (`vitals` in absolute.config.ts).
 *
 * The build bundles a small reporter (web-vitals plus a sender) to
 * /__absolute/vitals/reporter.js. Every framework client bundle gets a
 * one-line banner that imports it, and static HTML/HTMX pages get a module
 * <script> tag, the same way the PWA bootstrap is delivered. The reporter
 * samples once per page load, collects LCP, INP, CLS, FCP and TTFB with the
 * route and navigation type, and sends them as one batch when the page is
 * hidden or unloaded (sendBeacon, falling back to fetch keepalive). */

export const DEFAULT_VITALS_ENDPOINT = '/__absolute/vitals';
const REPORTER_PUBLIC_PATH = '/__absolute/vitals/reporter.js';
const REPORTER_MARKER = 'data-absolute-vitals';

/** Whether vitals are on for this build: production builds with `vitals`
 *  set, and dev builds only with `vitals.dev`. */
export const isVitalsEnabled = (
	config: VitalsConfig | undefined,
	isDev: boolean
) => Boolean(config) && (!isDev || config?.dev === true);

export const DEFAULT_VITALS_SUMMARY_PATH = '/__absolute/vitals/summary';

/* The summary endpoint is on in dev and off in production unless asked for,
 * which is the one place in this feature where the two modes differ, so it
 * is worth saying why rather than calling it a default.
 *
 * In dev the answer is obvious: you turned collection on to look at the
 * numbers, and a second config key standing between you and them is how the
 * current state — collect and discard — came to ship in the first place.
 *
 * In production the endpoint is an unauthenticated read of every route that
 * has reported and how slow it is. That is a map of the app plus its
 * weakest pages, which is a choice to publish, not a default to inherit.
 * Turning it on is one key; putting it behind auth or an internal-only path
 * is the project's to do, and `onVital()` feeds a real metrics backend
 * without exposing anything.
 *
 * A production 404 here is loud rather than silent, which is why this
 * asymmetry is acceptable where `logging` being dropped from the production
 * runtime keys was not. */
export const resolveVitalsSummary = (
	config: VitalsConfig,
	isDev: boolean
): ResolvedVitalsSummary | undefined => {
	const given = config.summary ?? isDev;
	if (given === false) return undefined;
	const options = given === true ? {} : given;

	return {
		maxRoutes: options.maxRoutes,
		path: options.path ?? DEFAULT_VITALS_SUMMARY_PATH
	};
};

export const resolveVitalsConfig = (config: VitalsConfig) => {
	const sampleRate = config.sampleRate ?? 1;
	if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
		throw new TypeError('vitals.sampleRate must be a number from 0 to 1.');
	}

	return {
		endpoint: config.endpoint ?? DEFAULT_VITALS_ENDPOINT,
		sampleRate
	};
};

/* The overlay is dev-only, so with it off this template produces exactly
 * what it produced before: `overlay` is undefined, the mount is absent and
 * the guard below collapses to `if (sampled)`. */
const reporterSource = (
	webVitalsModule: string,
	endpoint: string,
	sampleRate: number,
	overlay:
		| {
				module: string;
				summaryPath: string | undefined;
				thresholds: string;
		  }
		| undefined
) => `import { onCLS, onFCP, onINP, onLCP, onTTFB } from ${JSON.stringify(webVitalsModule)};
${
	overlay === undefined
		? ''
		: `import { mountVitalsOverlay } from ${JSON.stringify(overlay.module)};`
}
const endpoint = ${JSON.stringify(endpoint)};
/* sampleRate governs what is SENT. In dev the overlay also wants to show a
 * load that was not sampled — an overlay that is blank on three reloads out
 * of four is not a tool — so collection runs either way and flush is what
 * checks. */
const sampled = Math.random() < ${sampleRate};
${
	overlay === undefined
		? 'const overlay = undefined;'
		: `const overlay = mountVitalsOverlay({
	route: location.pathname,
	sampled,
	summaryPath: ${JSON.stringify(overlay.summaryPath)},
	/* VITAL_THRESHOLDS, so the overlay bands a value exactly as the
	 * summary endpoint does rather than keeping its own copy. */
	thresholds: ${overlay.thresholds}
});`
}
if (sampled || overlay !== undefined) {
	const route = location.pathname;
	const pending = new Map();
	let navigationType;
	const queue = (metric) => {
		navigationType = metric.navigationType;
		if (overlay !== undefined) overlay.report(metric);
		pending.set(metric.name, {
			delta: metric.delta,
			id: metric.id,
			name: metric.name,
			navigationType: metric.navigationType,
			rating: metric.rating,
			value: metric.value
		});
	};
	const flush = () => {
		if (!sampled || pending.size === 0) return;
		const body = JSON.stringify({ metrics: [...pending.values()], navigationType, route });
		pending.clear();
		const sent =
			typeof navigator.sendBeacon === 'function' &&
			navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
		if (!sent) {
			fetch(endpoint, {
				body,
				headers: { 'content-type': 'application/json' },
				keepalive: true,
				method: 'POST'
			}).catch(() => undefined);
		}
	};
	const options = { reportAllChanges: true };
	onCLS(queue, options);
	onFCP(queue, options);
	onINP(queue, options);
	onLCP(queue, options);
	onTTFB(queue, options);
	addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flush();
	});
	addEventListener('pagehide', flush);
}
`;

/** Prepended to every framework client bundle. */
const reporterBanner = () => `if (typeof window !== 'undefined') {
	import(new URL(${JSON.stringify(REPORTER_PUBLIC_PATH)}, window.location.origin).href).catch(() => undefined);
}
`;

/** Adds the reporter to a static HTML/HTMX page. */
export const injectVitalsReporterHtml = (html: string) => {
	if (html.includes(REPORTER_MARKER)) return html;
	const script = `<script type="module" src="${REPORTER_PUBLIC_PATH}" ${REPORTER_MARKER}></script>`;
	const closingHead = html.toLowerCase().indexOf('</head>');

	return closingHead >= 0
		? `${html.slice(0, closingHead)}${script}${html.slice(closingHead)}`
		: `${script}${html}`;
};

export type VitalsBuildArtifacts = { banner: string };

/* Source checkouts and published packages both colocate the dev client one
 * directory above this module (`src/build` -> `src/dev`, `dist/build` ->
 * `dist/dev`), the same resolution `generateReactIndexes` uses for the
 * error overlay. Windows separators would break the import specifier the
 * generated entry carries, so they are normalised. */
const overlayModulePath = () => {
	const fromPackage = resolve(import.meta.dir, '../dev/client');
	const dir = existsSync(fromPackage)
		? fromPackage
		: resolve(import.meta.dir, './dev/client');

	return join(dir, 'vitalsOverlay.ts').replace(/\\/gu, '/');
};

export const materializeVitalsReporter = async ({
	buildPath,
	config,
	generatedRoot,
	isDev = false,
	write = true
}: {
	buildPath: string;
	config: VitalsConfig;
	generatedRoot: string;
	/** Dev builds get the overlay bundled in; production builds never do. */
	isDev?: boolean;
	/** Incremental builds reuse the reporter from the full build. */
	write?: boolean;
}) => {
	const { endpoint, sampleRate } = resolveVitalsConfig(config);
	const artifacts: VitalsBuildArtifacts = { banner: reporterBanner() };
	if (!write) return artifacts;

	const entry = join(generatedRoot, 'vitals', 'reporter.ts');
	await mkdir(join(generatedRoot, 'vitals'), { recursive: true });
	await writeFile(
		entry,
		reporterSource(
			Bun.resolveSync('web-vitals', import.meta.dir),
			endpoint,
			sampleRate,
			isDev
				? {
						module: overlayModulePath(),
						summaryPath: resolveVitalsSummary(config, true)?.path,
						thresholds: JSON.stringify(VITAL_THRESHOLDS)
					}
				: undefined
		)
	);
	const outdir = join(buildPath, '__absolute', 'vitals');
	await rm(outdir, { force: true, recursive: true });
	const result = await Bun.build({
		entrypoints: [entry],
		format: 'esm',
		minify: true,
		naming: { entry: 'reporter.js' },
		outdir,
		target: 'browser'
	});
	if (!result.success) {
		throw new AggregateError(
			result.logs,
			'Failed to build the AbsoluteJS web vitals reporter.'
		);
	}

	return artifacts;
};
