/* The dev toolbar: what this page is actually made of, in the page.
 *
 * `docs/dev/absolute-studio.md` (now dev-toolbar.md) described a
 * dashboard at its own route,
 * in the present tense, with Overview / Routes / State / HMR / SSR panels.
 * None of it existed — no `/__absolute_studio`, no `/__absolute_dev/*`, no
 * state registry — so a reader following the doc got a 404.
 *
 * It is a toolbar rather than a route because the valuable half of
 * framework devtools needs THE PAGE. Which framework rendered this
 * document, which islands are on it, what each one's hydrate strategy and
 * persist key are, what the last soft navigation did: a separate document
 * can see none of that, and could only ever show what the server knows.
 * That page-scoped view is also the one thing no other devtools can give
 * here — React's sees React and Vue's sees Vue, and neither can show a
 * Svelte island inside a React page.
 *
 * Nothing new is instrumented for the island panel: every island already
 * carries `data-component`, `data-framework`, `data-hydrate` and
 * `data-absolute-persist` in its markup (core/islandMarkupAttributes.ts),
 * and the navigation layer already dispatches `absolute:after-navigate`.
 *
 * Three constraints the implementation is shaped by:
 *
 *   - A soft navigation REPLACES document.body (client/navigation.ts), so
 *     a toolbar mounted in the body disappears on the first navigation.
 *     This mounts on `documentElement` and re-renders on arrival.
 *   - Its styles must not reach the page and the page's must not reach it,
 *     so the whole thing lives in a shadow root. A dev tool that restyles
 *     the app it is inspecting is worse than no dev tool.
 *   - Collapsed it is a pill, not a panel: it paints a fixed-position
 *     element that shifts nothing, so it does not move the CLS and LCP the
 *     vitals badge is reporting two corners away. */

import { detectCurrentFramework } from './frameworkDetect';
import { subscribeHmrApplies } from './hmrTiming';
import { withClientBasePath } from './basePath';

const TOGGLE_KEY = 'D';
const STORAGE_KEY = 'absolute:devtoolbar';
const HOST_ID = 'absolute-dev-toolbar';
const MAX_ROWS = 40;
const REQUEST_LIMIT = 12;

type Panel = 'hmr' | 'network' | 'page';

export type IslandFact = {
	component: string;
	framework: string;
	hydrate: string;
	persist: string | undefined;
};

type ToolbarState = {
	open: boolean;
	panel: Panel;
};

const readState = () => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
		const open = Reflect.get(Object(parsed), 'open') === true;
		const panel: unknown = Reflect.get(Object(parsed), 'panel');

		const stored: ToolbarState = {
			open,
			panel: panel === 'hmr' || panel === 'network' ? panel : 'page'
		};

		return stored;
	} catch {
		/* Private windows and blocked site data: the toolbar still works,
		 * it just does not remember. */
		const fallback: ToolbarState = { open: false, panel: 'page' };

		return fallback;
	}
};

const writeState = (state: ToolbarState) => {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* Not worth a console warning in someone else's app. */
	}
};

/** Every island on the page, read from the markup the server and client
 *  both produce. */
export const islandFacts = (root: ParentNode) =>
	Array.from(root.querySelectorAll('[data-island="true"]')).map(
		(element) => ({
			component: element.getAttribute('data-component') ?? '(unnamed)',
			framework: element.getAttribute('data-framework') ?? '(unknown)',
			hydrate: element.getAttribute('data-hydrate') ?? 'load',
			persist: element.getAttribute('data-absolute-persist') ?? undefined
		})
	);

const STYLES = `
	:host { all: initial; }
	* { box-sizing: border-box; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
	.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
	.pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #2b3245; border-radius: 999px; background: #10131d; color: #e8ecff; cursor: pointer; box-shadow: 0 2px 10px rgb(0 0 0 / 0.3); }
	.pill:hover { border-color: #4d5675; }
	.dot { width: 7px; height: 7px; border-radius: 50%; background: #5ee0a0; }
	.count { opacity: 0.65; }
	.panel { width: min(440px, calc(100vw - 32px)); max-height: min(60vh, 420px); overflow: auto; border: 1px solid #2b3245; border-radius: 10px; background: #0b0e16; color: #e8ecff; box-shadow: 0 10px 30px rgb(0 0 0 / 0.45); }
	.tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid #1d2231; position: sticky; top: 0; background: #0b0e16; }
	.tab { padding: 4px 10px; border: 0; border-radius: 6px; background: transparent; color: #9aa6c4; cursor: pointer; }
	.tab[aria-selected='true'] { background: #1b2234; color: #e8ecff; }
	.body { padding: 10px 12px 12px; }
	table { width: 100%; border-collapse: collapse; }
	th, td { text-align: left; padding: 4px 6px 4px 0; vertical-align: top; }
	th { color: #8e9ab8; font-weight: 500; }
	tr + tr td { border-top: 1px solid #161b28; }
	.fw { color: #8fd0ff; }
	.muted { color: #7d89a6; }
	.empty { color: #7d89a6; padding: 6px 0; }
	kbd { border: 1px solid #2b3245; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
`;

/* An HMR source arrives as an absolute path — the dev server's own path
 * on disk, 70 characters of it before the part anyone reads. The client
 * has no project root to make it relative to, so the tail is shown and
 * the whole path goes in the tooltip. */
const TAIL_SEGMENTS = 3;

const shortenPath = (path: string) => {
	const segments = path.split('/').filter((segment) => segment !== '');
	if (segments.length <= TAIL_SEGMENTS) return path;

	return `…/${segments.slice(-TAIL_SEGMENTS).join('/')}`;
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

const pageRows = () => {
	const islands = islandFacts(document);
	if (islands.length === 0)
		return `<p class="empty">No islands on this page.</p>`;
	const rows = islands
		.map(
			(island) =>
				`<tr><td>${escapeHtml(island.component)}</td><td class="fw">${escapeHtml(island.framework)}</td><td class="muted">${escapeHtml(island.hydrate)}</td><td class="muted">${island.persist === undefined ? '' : escapeHtml(island.persist)}</td></tr>`
		)
		.join('');

	return `<table><tr><th>island</th><th>framework</th><th>hydrate</th><th>persist</th></tr>${rows}</table>`;
};

/* `window.__ABS_HMR_APPLIES__` is where this already lives: a capped
 * buffer the HMR client has kept all along, persisted to sessionStorage so
 * it survives a reload. The first version of this panel shipped its own
 * ring buffer before checking — which duplicated existing state and lost
 * the persistence. */
const hmrRows = () => {
	const events = (window.__ABS_HMR_APPLIES__ ?? [])
		.slice(-MAX_ROWS)
		.reverse();
	if (events.length === 0)
		return `<p class="empty">No HMR updates yet. Edit a file.</p>`;

	return `<table><tr><th>file</th><th>kind</th><th>outcome</th><th>ms</th></tr>${events
		.map(
			(event) =>
				`<tr><td title="${escapeHtml(event.source ?? '')}">${escapeHtml(event.source === undefined ? '' : shortenPath(event.source))}</td><td class="fw">${escapeHtml(event.kind ?? '')}</td><td class="muted">${escapeHtml(event.outcome)}</td><td class="muted">${String(event.duration)}</td></tr>`
		)
		.join('')}</table>`;
};

type RouteRow = { method?: string; path?: string };

const fetchJson = async (path: string) => {
	try {
		const response = await fetch(withClientBasePath(path));
		const parsed: unknown = await response.json();

		return parsed;
	} catch {
		/* The dev server restarting mid-fetch is not worth an error in
		 * someone else's console. */
		return undefined;
	}
};

const networkRows = async () => {
	const [routes, requests] = await Promise.all([
		fetchJson('/__absolute/routes'),
		fetchJson('/__absolute/requests')
	]);
	const routeList = Array.isArray(routes) ? routes : [];
	const requestList = Array.isArray(requests) ? requests : [];
	const recent = requestList
		.slice(-REQUEST_LIMIT)
		.reverse()
		.map((entry: unknown) => {
			const row: RouteRow = Object(entry);

			return `<tr><td class="fw">${escapeHtml(row.method ?? '')}</td><td>${escapeHtml(row.path ?? '')}</td></tr>`;
		})
		.join('');

	return `<p class="muted">${routeList.length} routes registered</p>${
		recent === ''
			? '<p class="empty">No requests recorded yet.</p>'
			: `<table><tr><th>method</th><th>recent request</th></tr>${recent}</table>`
	}`;
};

const host = () => {
	const existing = document.getElementById(HOST_ID);
	if (existing !== null) return existing;
	const element = document.createElement('div');
	element.id = HOST_ID;
	/* A link inside the toolbar must never be taken for a page
	 * navigation, and the toolbar must never be swapped as page content. */
	element.setAttribute('data-absolute-navigation', 'off');
	/* documentElement, not body: a soft navigation replaces the body. */
	document.documentElement.append(element);

	return element;
};

/** Mounts the toolbar. Safe to call repeatedly: a second call re-renders
 *  the existing one rather than adding another. */
/* Where the toolbar does not belong. Inside a frame the page is being shown
 * by something else -- an editor's live preview, a design tool -- and that
 * host is already the dev tool; a pill floating over its preview reads as
 * part of the site. And a page can say it is not an app under development
 * at all (an editor's own interface, built with the framework) with
 * `<html data-absolute-dev-toolbar="off">`. */
export const DEV_TOOLBAR_OPT_OUT = 'data-absolute-dev-toolbar';

export const devToolbarWanted = (target: Window = window) => {
	if (
		target.document.documentElement.getAttribute(DEV_TOOLBAR_OPT_OUT) ===
		'off'
	)
		return false;
	try {
		return target.self === target.top;
	} catch {
		// A cross-origin parent: framed all the same.
		return false;
	}
};

export const installDevToolbar = () => {
	if (typeof document === 'undefined') return;
	if (!devToolbarWanted()) return;
	const element = host();
	const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
	/* A soft navigation re-runs the incoming page's module entries under a
	 * fresh URL, so this install runs again on every visit. Without this
	 * guard each one would add another keydown handler, another click
	 * handler and another HMR subscription — the accumulation that made an
	 * island mount once per visit SQUARED (client/islandHydrationState.ts).
	 * The re-render still happens, via the navigation event below. */
	if (element.dataset.installed === 'true') return;
	element.dataset.installed = 'true';
	let state = readState();

	const render = async () => {
		const framework = detectCurrentFramework() ?? 'unknown';
		const islands = islandFacts(document);
		const body = state.open
			? `<div class="panel"><div class="tabs">${(
					[
						['page', 'Page'],
						['hmr', 'HMR'],
						['network', 'Network']
					] as const
				)
					.map(
						([id, label]) =>
							`<button class="tab" data-panel="${id}" aria-selected="${state.panel === id}">${label}</button>`
					)
					.join('')}</div><div class="body" data-body>${
					state.panel === 'page'
						? `<p class="muted">rendered by <span class="fw">${escapeHtml(framework)}</span> · <kbd>shift</kbd>+<kbd>alt</kbd>+<kbd>${TOGGLE_KEY}</kbd> toggles</p>${pageRows()}`
						: ''
				}${state.panel === 'hmr' ? hmrRows() : ''}${
					state.panel === 'network'
						? '<p class="empty">Loading…</p>'
						: ''
				}</div></div>`
			: '';
		root.innerHTML = `<style>${STYLES}</style><div class="wrap">${body}<button class="pill" data-toggle><span class="dot"></span>AbsoluteJS<span class="count">${islands.length} island${islands.length === 1 ? '' : 's'}</span></button></div>`;
		if (state.open && state.panel === 'network') {
			const markup = await networkRows();
			const target = root.querySelector('[data-body]');
			if (target !== null) target.innerHTML = markup;
		}
	};

	const update = (next: Partial<ToolbarState>) => {
		state = { ...state, ...next };
		writeState(state);
		void render();
	};

	root.addEventListener('click', (event) => {
		const { target } = event;
		if (!(target instanceof Element)) return;
		if (target.closest('[data-toggle]') !== null) {
			update({ open: !state.open });

			return;
		}
		const tab = target.closest('[data-panel]');
		const panel = tab?.getAttribute('data-panel');
		if (panel === 'page' || panel === 'hmr' || panel === 'network')
			update({ open: true, panel });
	});

	window.addEventListener('keydown', (event) => {
		if (!event.shiftKey || !event.altKey) return;
		if (event.key.toUpperCase() !== TOGGLE_KEY) return;
		event.preventDefault();
		update({ open: !state.open });
	});

	/* The body is replaced on a soft navigation, so the island table and
	 * the framework line are both stale on arrival. */
	window.addEventListener('absolute:after-navigate', () => {
		host();
		void render();
	});

	subscribeHmrApplies(() => {
		if (state.open && state.panel === 'hmr') void render();
	});

	void render();
};
