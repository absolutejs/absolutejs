/* The dev-only web vitals overlay: what this page load actually measured,
 * and how it compares to every load this server has seen.
 *
 * Dev only, and bundled into the reporter only for dev builds, so none of
 * this reaches a production bundle.
 *
 * Why a badge rather than a devtools panel: the numbers that matter here
 * arrive at different times — TTFB immediately, LCP when the largest paint
 * settles, INP not until you interact, CLS whenever something moves. A
 * panel you have to open is a panel you open once the interesting moment
 * has passed. A badge that fills in as the metrics land shows you the
 * shape of the load without being asked.
 *
 * The thresholds are handed in, serialized at build time from
 * `VITAL_THRESHOLDS` in `src/core/vitalsStore.ts` — the same constant the
 * summary endpoint bands with. An overlay colouring a value green while
 * the summary calls that value poor is worse than no overlay, and a second
 * copy of five pairs of numbers is exactly the kind of duplication that
 * drifts, so there is only one.
 *
 * Injected rather than imported because this module ships as
 * `dist/dev/client/vitalsOverlay.ts` while `src/core/` ships only as
 * bundled output and declarations — there is no `dist/core/vitalsStore.js`
 * to import, and a source checkout would resolve such an import and hide
 * that from every local check.
 *
 * That goes for TYPE imports too, which is not obvious: the bundler erases
 * them, so bundling succeeds either way, but `scripts/build.ts` resolves
 * every import in the published dev client and fails the build on one it
 * cannot follow. It caught exactly this. Hence the metric names below are
 * projected out of the summary types rather than imported from
 * `src/core/vitals`: `types/` is reachable from here, `src/core/` is not.
 *
 * Collection and reporting are separated in dev. `sampleRate` governs what
 * is POSTed to the server; the overlay shows this load whether or not it
 * was sampled, because an overlay that is blank on three reloads out of
 * four is not a tool. When a load is not sampled it says so, so you are
 * never left wondering whether the page was fast or the reporter was
 * quiet. */

import type {
	VitalRating,
	VitalsRouteSummary,
	VitalsSummary
} from '../../../types/vitals';

/** The metrics the summary reports on, which are the ones worth showing. */
type VitalName = keyof VitalsRouteSummary['metrics'];

/** The published Core Web Vitals thresholds for one metric: at or under the
 *  first is good, at or under the second needs improvement, past it is
 *  poor. Serialized into the generated reporter from `VITAL_THRESHOLDS`. */
export type VitalThresholds = Record<VitalName, readonly [number, number]>;

const CONTAINER_ID = '__abs_vitals_overlay__';
const OPEN_KEY = '__abs_vitals_overlay_open';
const HIDDEN_KEY = '__abs_vitals_overlay_hidden';
const REFRESH_MS = 5000;
const SECOND_MS = 1000;
const CLS_DECIMALS = 3;

/* Below the error overlay: a build error is the more urgent thing on
 * screen, and this must never cover it. Bottom-LEFT because HMR toasts
 * stack bottom-right. */
const Z_INDEX = '2147483640';

const COLORS: Record<VitalRating, string> = {
	good: '#4ade80',
	'needs-improvement': '#fbbf24',
	poor: '#f87171'
};

/* The order a load produces them in, which is also the order they become
 * interesting: how fast the server answered, when something was painted,
 * when the main content settled, how much it moved, how it felt to use. */
const ORDER: readonly VitalName[] = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP'];

type Seen = {
	rating: VitalRating;
	value: number;
};

const read = (storage: Storage, key: string) => {
	try {
		return storage.getItem(key);
	} catch {
		/* Private windows and blocked site data both throw here. The
		 * overlay is worth less than the page, so it takes its default. */
		return null;
	}
};

const write = (storage: Storage, key: string, value: string) => {
	try {
		storage.setItem(key, value);
	} catch {
		/* See `read`: a remembered preference is not worth an exception. */
	}
};

/** Milliseconds as something readable at a glance: `840ms`, `1.24s`. CLS is
 *  unitless, so it gets no unit, and trailing zeros are dropped: its
 *  thresholds are published as 0.1 and 0.25, and printing them 0.100 and
 *  0.250 makes the overlay look like it means something more precise. */
const format = (name: VitalName, value: number) => {
	if (name === 'CLS') return String(Number(value.toFixed(CLS_DECIMALS)));
	if (value < SECOND_MS) return `${Math.round(value)}ms`;

	return `${(value / SECOND_MS).toFixed(2)}s`;
};

const styled = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	style: Partial<CSSStyleDeclaration>,
	text?: string
) => {
	const element = document.createElement(tag);
	Object.assign(element.style, style);
	if (text !== undefined) element.textContent = text;

	return element;
};

const MONO =
	'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const chipRow = (seen: Map<VitalName, Seen>, sampled: boolean) => {
	const row = styled('div', {
		alignItems: 'center',
		display: 'flex',
		gap: '10px'
	});
	const measured = ORDER.filter((name) => seen.has(name));
	if (measured.length === 0) {
		row.appendChild(
			styled('span', { color: '#64748b' }, 'waiting for metrics…')
		);

		return row;
	}
	for (const name of measured) {
		const entry = seen.get(name);
		if (entry === undefined) continue;
		const chip = styled('span', {
			alignItems: 'baseline',
			display: 'inline-flex',
			gap: '4px'
		});
		chip.appendChild(
			styled('span', { color: '#94a3b8', fontSize: '10px' }, name)
		);
		chip.appendChild(
			styled(
				'span',
				{ color: COLORS[entry.rating], fontWeight: '600' },
				format(name, entry.value)
			)
		);
		row.appendChild(chip);
	}
	if (!sampled)
		row.appendChild(
			styled(
				'span',
				{ color: '#64748b', fontSize: '10px' },
				'· not sampled'
			)
		);

	return row;
};

const ratingFor = (
	thresholds: VitalThresholds,
	name: VitalName,
	value: number
) => {
	const [good, poor] = thresholds[name];
	if (value <= good) return 'good';

	return value <= poor ? 'needs-improvement' : 'poor';
};

const thresholdNote = (thresholds: VitalThresholds, name: VitalName) => {
	const [good, poor] = thresholds[name];

	return `good ≤ ${format(name, good)}, poor > ${format(name, poor)}`;
};

const detailTable = (
	seen: Map<VitalName, Seen>,
	summary: VitalsSummary | undefined,
	route: string,
	thresholds: VitalThresholds
) => {
	const table = styled('div', {
		display: 'grid',
		gap: '2px 12px',
		gridTemplateColumns: 'auto auto auto 1fr',
		marginTop: '8px'
	});
	const header = ['', 'this load', 'p75', ''];
	for (const label of header)
		table.appendChild(
			styled('span', { color: '#64748b', fontSize: '10px' }, label)
		);

	const forRoute = summary?.routes.find((entry) => entry.route === route);
	for (const name of ORDER) {
		const entry = seen.get(name);
		const aggregate = forRoute?.metrics[name];
		table.appendChild(
			styled('span', { color: '#94a3b8', fontSize: '11px' }, name)
		);
		table.appendChild(
			styled(
				'span',
				{
					color:
						entry === undefined ? '#475569' : COLORS[entry.rating],
					fontSize: '11px'
				},
				entry === undefined ? '—' : format(name, entry.value)
			)
		);
		table.appendChild(
			styled(
				'span',
				{
					color:
						aggregate === undefined
							? '#475569'
							: COLORS[aggregate.rating],
					fontSize: '11px'
				},
				aggregate === undefined
					? '—'
					: `${format(name, aggregate.p75)} (${aggregate.count})`
			)
		);
		table.appendChild(
			styled(
				'span',
				{ color: '#475569', fontSize: '10px' },
				thresholdNote(thresholds, name)
			)
		);
	}

	return table;
};

export type VitalsOverlayHandle = {
	report: (metric: { name: VitalName; value: number }) => void;
};

export type VitalsOverlayOptions = {
	/** The route the reporter attributes this load to, so the overlay reads
	 *  the same row the server would record against. */
	route: string;
	/** Whether this load will be POSTed, which `sampleRate` decides. The
	 *  overlay shows the load either way and says when it will not be. */
	sampled: boolean;
	/** Where to read the aggregate. Left out, the overlay shows this load
	 *  only — which is what happens when `summary` is off. */
	summaryPath?: string;
	/** `VITAL_THRESHOLDS`, serialized at build time, so the overlay bands a
	 *  value exactly as the summary endpoint does. */
	thresholds: VitalThresholds;
};

/** Mounts the badge and returns a `report` to feed each metric to. Safe to
 *  call when there is no document: it returns an inert handle. */
export const mountVitalsOverlay = ({
	route,
	sampled,
	summaryPath,
	thresholds
}: VitalsOverlayOptions) => {
	const inert: VitalsOverlayHandle = { report: () => undefined };
	if (typeof document === 'undefined') return inert;
	/* sessionStorage, not local: dismissing it should not be a decision you
	 * made once in March and cannot remember how to undo. A new tab brings
	 * it back. */
	if (read(sessionStorage, HIDDEN_KEY) === '1') return inert;
	if (document.getElementById(CONTAINER_ID)) return inert;

	const seen = new Map<VitalName, Seen>();
	let summary: VitalsSummary | undefined = undefined;
	let open = read(localStorage, OPEN_KEY) === '1';
	let timer: ReturnType<typeof setInterval> | undefined = undefined;

	const container = styled('div', {
		background: 'rgba(15, 17, 22, 0.94)',
		borderRadius: '8px',
		bottom: '16px',
		boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
		color: '#f8fafc',
		fontFamily: MONO,
		fontSize: '12px',
		left: '16px',
		maxWidth: 'calc(100vw - 32px)',
		padding: '8px 10px',
		position: 'fixed',
		zIndex: Z_INDEX
	});
	container.id = CONTAINER_ID;

	const body = styled('div', {});
	const head = styled('div', {
		alignItems: 'center',
		cursor: 'pointer',
		display: 'flex',
		gap: '10px'
	});
	const close = styled(
		'span',
		{ color: '#475569', cursor: 'pointer', fontSize: '14px', order: '9' },
		'×'
	);
	close.title = 'Hide until this tab is reopened';

	const render = () => {
		head.textContent = '';
		head.appendChild(chipRow(seen, sampled));
		head.appendChild(close);
		body.textContent = '';
		if (!open) return;
		body.appendChild(detailTable(seen, summary, route, thresholds));
		const foot = styled('div', {
			color: '#475569',
			fontSize: '10px',
			marginTop: '6px'
		});
		foot.textContent =
			summaryPath === undefined
				? 'p75 needs the summary endpoint (vitals.summary)'
				: `${summary?.sampleCount ?? 0} samples since ${
						summary?.since.slice(11, 19) ?? '—'
					}${summary?.truncated === true ? ' · routes evicted' : ''}`;
		body.appendChild(foot);
	};

	const refresh = async () => {
		if (summaryPath === undefined) return;
		try {
			const response = await fetch(summaryPath, {
				headers: { accept: 'application/json' }
			});
			if (!response.ok) return;
			summary = await response.json();
			render();
		} catch {
			/* The server restarting mid-poll is normal in dev. */
		}
	};

	const setOpen = (next: boolean) => {
		open = next;
		write(localStorage, OPEN_KEY, next ? '1' : '0');
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		render();
		if (!next) return;
		void refresh();
		/* Only while open, so a collapsed badge costs no requests. */
		timer = setInterval(() => void refresh(), REFRESH_MS);
	};

	head.addEventListener('click', (event) => {
		if (event.target === close) return;
		setOpen(!open);
	});
	close.addEventListener('click', () => {
		write(sessionStorage, HIDDEN_KEY, '1');
		if (timer !== undefined) clearInterval(timer);
		container.remove();
	});

	container.appendChild(head);
	container.appendChild(body);
	document.body.appendChild(container);
	setOpen(open);

	const handle: VitalsOverlayHandle = {
		report: (metric) => {
			seen.set(metric.name, {
				rating: ratingFor(thresholds, metric.name, metric.value),
				value: metric.value
			});
			render();
		}
	};

	return handle;
};
