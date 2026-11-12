import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Set `vitals` in absolute.config.ts (`{ endpoint?, sampleRate?, dev? }`) to report LCP, INP, CLS, FCP and TTFB from real visits. A production build bundles a small reporter (web-vitals plus a sender) that every framework's client bundle imports and that static HTML/HTMX pages load with a script tag. Each page load samples once, and a page that reports sends one batch, with its route and navigation type, when it's hidden or closed (`sendBeacon`, falling back to `fetch` keepalive). `prepare()` serves `POST /__absolute/vitals`, validated with a TypeBox schema. It stores nothing; register `onVital(handler)` to forward the metrics to your own store. With `vitals` unset nothing is built or injected, and dev reports only with `dev: true`. It works on pre-rendered pages and under `secureHeaders()`. See docs/WEB_VITALS.md.",
	kind: 'added',
	summary: 'Opt-in Core Web Vitals reporting with `vitals` and `onVital()`',
	symbols: ['onVital']
};
