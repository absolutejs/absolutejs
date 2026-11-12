import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VitalsConfig } from '../../types/build';

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

const reporterSource = (
	webVitalsModule: string,
	endpoint: string,
	sampleRate: number
) => `import { onCLS, onFCP, onINP, onLCP, onTTFB } from ${JSON.stringify(webVitalsModule)};

const endpoint = ${JSON.stringify(endpoint)};
if (Math.random() < ${sampleRate}) {
	const route = location.pathname;
	const pending = new Map();
	let navigationType;
	const queue = (metric) => {
		navigationType = metric.navigationType;
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
		if (pending.size === 0) return;
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

export const materializeVitalsReporter = async ({
	buildPath,
	config,
	generatedRoot,
	write = true
}: {
	buildPath: string;
	config: VitalsConfig;
	generatedRoot: string;
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
			sampleRate
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
