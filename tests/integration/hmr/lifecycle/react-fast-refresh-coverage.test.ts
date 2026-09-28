import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runtimeSupportsReactFastRefresh } from '../../../../src/cli/patchedBun';
import {
	openReadyPage,
	type BrowserSession,
	waitForText
} from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { createFile, mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const REACT_DIR = resolve(PROJECT_ROOT, 'example/react');
const APP = resolve(REACT_DIR, 'components/App.tsx');
const PAGE = resolve(REACT_DIR, 'pages/ReactExample.tsx');
const HEADING = '<h1>AbsoluteJS + React</h1>';
const COUNT_BUTTON = 'main > button';
const OVERLAY = '#absolutejs-error-overlay';
const CLICKS = 3;
const UPDATE_TIMEOUT_MS = 15_000;

let server: DevServer | undefined;
let client: HMRClient | undefined;
let session: BrowserSession | undefined;

afterEach(async () => {
	await session?.close();
	session = undefined;
	client?.close();
	client = undefined;
	await server?.kill();
	server = undefined;
	restoreAllFiles();
});

/* React Fast Refresh needs the transpiler to register components
 * ($RefreshReg$/$RefreshSig$). Stock Bun ignores `reactFastRefresh` on
 * Bun.Transpiler (oven-sh/bun#32919), so the state-preserving cases only mean
 * something on a Bun with the fix. Run them with AbsoluteJS's patched Bun:
 *   ~/.absolutejs/bun/<release>/<platform>/bun test tests/integration/hmr/lifecycle/react-fast-refresh-coverage.test.ts
 * BUN-REACT-REFRESH-LEGACY: drop the skip once the minimum Bun has the fix. */
const fastRefresh = runtimeSupportsReactFastRefresh();

const importIntoApp = (specifier: string, names: string) =>
	mutateFile(APP, (text) =>
		text.replace(
			"import { useState } from 'react';",
			`import { useState } from 'react';\nimport { ${names} } from '${specifier}';`
		)
	);

const renderInApp = (markup: string, prelude = '') =>
	mutateFile(APP, (text) =>
		text
			.replace(
				'const [count, setCount] = useState(initialCount);',
				`const [count, setCount] = useState(initialCount);\n${prelude}`
			)
			.replace(HEADING, `${HEADING}\n\t\t\t${markup}`)
	);

/* Fixtures are written BEFORE the server boots, so the first page load is
 * the real starting point; the test then edits them mid-session. */
const openCounted = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();
	session = await openReadyPage(`${server.baseUrl}/react`, async (page) => {
		await waitForText(
			page,
			COUNT_BUTTON,
			(text) => /count is \d+/.test(text),
			UPDATE_TIMEOUT_MS
		);
	});
	const { page } = session;
	for (let click = 1; click <= CLICKS; click++) {
		await page.click(COUNT_BUTTON);
		await waitForText(page, COUNT_BUTTON, (text) =>
			text.includes(`count is ${click}`)
		);
	}
	// A full page reload would drop this; an in-place update keeps it.
	await page.evaluate(() => {
		Reflect.set(window, '__reactHmrDocument', 'kept');
	});
	client.drain();

	return { hmr: client, page, srv: server };
};

type Page = BrowserSession['page'];

const documentKept = (page: Page) =>
	page.evaluate(() => Reflect.get(window, '__reactHmrDocument') === 'kept');

const expectCountKept = async (page: Page) => {
	expect(await page.textContent(COUNT_BUTTON)).toContain(
		`count is ${CLICKS}`
	);
	expect(await documentKept(page)).toBe(true);
};

/* No reload on any Bun. Only Fast Refresh keeps component state; the stock-Bun
 * remount (BUN-REACT-REFRESH-LEGACY) re-creates the tree. */
const expectAppliedInPlace = async (page: Page) => {
	if (fastRefresh) {
		await expectCountKept(page);

		return;
	}
	expect(await documentKept(page)).toBe(true);
};

const waitForUpdate = async (
	hmr: HMRClient,
	page: Page,
	selector: string,
	expected: string
) => {
	await hmr.waitFor('react-update', UPDATE_TIMEOUT_MS);

	return waitForText(
		page,
		selector,
		(text) => text.includes(expected),
		UPDATE_TIMEOUT_MS
	);
};

describe.skipIf(!fastRefresh)('React Fast Refresh deep coverage', () => {
	test('context provider value change reaches the consumer', async () => {
		createFile(
			resolve(REACT_DIR, 'components/ProbeTheme.tsx'),
			[
				"import { createContext, useContext } from 'react';",
				'',
				"export const ProbeThemeContext = createContext('NO_PROVIDER');",
				'',
				'export const ProbeThemeBadge = () => {',
				'\tconst theme = useContext(ProbeThemeContext);',
				'',
				'\treturn <p id="probe-theme">{`THEME_${theme}`}</p>;',
				'};',
				''
			].join('\n')
		);
		importIntoApp('./ProbeTheme', 'ProbeThemeBadge, ProbeThemeContext');
		renderInApp(
			'<ProbeThemeContext.Provider value="CTX_ONE"><ProbeThemeBadge /></ProbeThemeContext.Provider>'
		);
		const { hmr, page } = await openCounted();
		expect(await page.textContent('#probe-theme')).toBe('THEME_CTX_ONE');

		mutateFile(APP, (text) =>
			text.replace('value="CTX_ONE"', 'value="CTX_TWO"')
		);
		await waitForUpdate(hmr, page, '#probe-theme', 'THEME_CTX_TWO');
		await expectCountKept(page);
	}, 90_000);

	test('custom hook body change propagates and keeps its state', async () => {
		const hook = resolve(REACT_DIR, 'hooks/useProbeCounter.ts');
		createFile(
			hook,
			[
				"import { useState } from 'react';",
				'',
				'export const useProbeCounter = () => {',
				'\tconst [hits, setHits] = useState(0);',
				"\tconst label = 'HOOK_ONE';",
				'',
				'\treturn { hits, hit: () => setHits(hits + 1), label };',
				'};',
				''
			].join('\n')
		);
		createFile(
			resolve(REACT_DIR, 'components/ProbeHookButton.tsx'),
			[
				"import { useProbeCounter } from '../hooks/useProbeCounter';",
				'',
				'export const ProbeHookButton = () => {',
				'\tconst { hits, hit, label } = useProbeCounter();',
				'',
				'\treturn (',
				'\t\t<button id="probe-hook" onClick={hit} type="button">',
				'\t\t\t{`${label} hits ${hits}`}',
				'\t\t</button>',
				'\t);',
				'};',
				''
			].join('\n')
		);
		mutateFile(PAGE, (text) =>
			text
				.replace(
					"import { App } from '../components/App';",
					"import { App } from '../components/App';\nimport { ProbeHookButton } from '../components/ProbeHookButton';"
				)
				.replace(
					'<App initialCount={initialCount} />',
					'<App initialCount={initialCount} />\n\t\t\t<ProbeHookButton />'
				)
		);
		const { hmr, page } = await openCounted();
		await page.click('#probe-hook');
		await page.click('#probe-hook');
		await waitForText(page, '#probe-hook', (text) =>
			text.includes('HOOK_ONE hits 2')
		);

		// The hook's signature (its hook calls) is unchanged, so Fast
		// Refresh keeps the component's state.
		mutateFile(hook, (text) => text.replace('HOOK_ONE', 'HOOK_TWO'));
		await waitForUpdate(hmr, page, '#probe-hook', 'HOOK_TWO');
		expect(await page.textContent('#probe-hook')).toBe('HOOK_TWO hits 2');
		await expectCountKept(page);
	}, 90_000);

	test('`useMemo` / `useCallback` body change applies, dependencies unchanged', async () => {
		mutateFile(APP, (text) =>
			text.replace(
				"import { useState } from 'react';",
				"import { useCallback, useMemo, useState } from 'react';"
			)
		);
		renderInApp(
			'<p id="probe-memo">{`MEMO_${tripled}_${label()}`}</p>',
			"\tconst tripled = useMemo(() => 7, []);\n\tconst label = useCallback(() => 'CB_ONE', []);"
		);
		const { hmr, page } = await openCounted();
		expect(await page.textContent('#probe-memo')).toBe('MEMO_7_CB_ONE');

		// Fast Refresh ignores dependency lists: both bodies re-run.
		mutateFile(APP, (text) =>
			text
				.replace('useMemo(() => 7, [])', 'useMemo(() => 11, [])')
				.replace("() => 'CB_ONE'", "() => 'CB_TWO'")
		);
		await waitForUpdate(hmr, page, '#probe-memo', 'MEMO_11_CB_TWO');
		await expectCountKept(page);
	}, 90_000);

	test('conditional-render edit toggles the branch', async () => {
		renderInApp(
			'{count > 100 ? <p id="probe-branch">BRANCH_HIGH</p> : <p id="probe-branch">BRANCH_LOW</p>}'
		);
		const { hmr, page } = await openCounted();
		expect(await page.textContent('#probe-branch')).toBe('BRANCH_LOW');

		mutateFile(APP, (text) => text.replace('count > 100 ?', 'count >= 0 ?'));
		await waitForUpdate(hmr, page, '#probe-branch', 'BRANCH_HIGH');
		await expectCountKept(page);
	}, 90_000);

	test('list rendering renders every item, and an edit reaches each one', async () => {
		renderInApp(
			"<ul id=\"probe-list\">{['alpha', 'beta', 'gamma'].map((item) => <li key={item}>{`ONE_${item}`}</li>)}</ul>"
		);
		const { hmr, page } = await openCounted();
		expect(await page.locator('#probe-list li').allTextContents()).toEqual([
			'ONE_alpha',
			'ONE_beta',
			'ONE_gamma'
		]);

		mutateFile(APP, (text) =>
			text
				.replace('`ONE_${item}`', '`TWO_${item}`')
				.replace("'gamma']", "'gamma', 'delta']")
		);
		await waitForUpdate(hmr, page, '#probe-list', 'TWO_delta');
		expect(await page.locator('#probe-list li').allTextContents()).toEqual([
			'TWO_alpha',
			'TWO_beta',
			'TWO_gamma',
			'TWO_delta'
		]);
		await expectCountKept(page);
	}, 90_000);

	test('`useEffect` cleanup runs and the effect re-runs after a refresh', async () => {
		const effect = resolve(REACT_DIR, 'components/ProbeEffect.tsx');
		createFile(
			effect,
			[
				"import { useEffect } from 'react';",
				'',
				'type ProbeWindow = Window & { __probeRuns?: number; __probeCleanups?: number };',
				'',
				'export const ProbeEffect = () => {',
				'\tuseEffect(() => {',
				'\t\tconst probe: ProbeWindow = window;',
				'\t\tprobe.__probeRuns = (probe.__probeRuns ?? 0) + 1;',
				'',
				'\t\treturn () => {',
				'\t\t\tprobe.__probeCleanups = (probe.__probeCleanups ?? 0) + 1;',
				'\t\t};',
				'\t}, []);',
				'',
				"\treturn <p id=\"probe-effect\">{'EFFECT_ONE'}</p>;",
				'};',
				''
			].join('\n')
		);
		importIntoApp('./ProbeEffect', 'ProbeEffect');
		renderInApp('<ProbeEffect />');
		const { hmr, page } = await openCounted();
		const counters = () =>
			page.evaluate(() => ({
				cleanups: Number(Reflect.get(window, '__probeCleanups') ?? 0),
				runs: Number(Reflect.get(window, '__probeRuns') ?? 0)
			}));
		const before = await counters();
		expect(before.runs).toBeGreaterThanOrEqual(1);

		mutateFile(effect, (text) => text.replace('EFFECT_ONE', 'EFFECT_TWO'));
		await waitForUpdate(hmr, page, '#probe-effect', 'EFFECT_TWO');
		const after = await counters();
		expect(after.cleanups).toBeGreaterThan(before.cleanups);
		expect(after.runs).toBeGreaterThan(before.runs);
		await expectCountKept(page);
	}, 90_000);

	test('`React.memo` and `forwardRef` components refresh in place', async () => {
		const wrapped = resolve(REACT_DIR, 'components/ProbeWrapped.tsx');
		createFile(
			wrapped,
			[
				"import { forwardRef, memo } from 'react';",
				'',
				'export const ProbeMemo = memo(function ProbeMemo() {',
				"\treturn <p id=\"probe-memo-component\">{'MEMO_ONE'}</p>;",
				'});',
				'',
				'export const ProbeForward = forwardRef<HTMLParagraphElement>(',
				'\tfunction ProbeForward(_props, ref) {',
				"\t\treturn <p id=\"probe-forward\" ref={ref}>{'FORWARD_ONE'}</p>;",
				'\t}',
				');',
				''
			].join('\n')
		);
		importIntoApp('./ProbeWrapped', 'ProbeForward, ProbeMemo');
		renderInApp('<ProbeMemo />\n\t\t\t<ProbeForward />');
		const { hmr, page } = await openCounted();

		mutateFile(wrapped, (text) =>
			text
				.replace('MEMO_ONE', 'MEMO_TWO')
				.replace('FORWARD_ONE', 'FORWARD_TWO')
		);
		await waitForUpdate(hmr, page, '#probe-forward', 'FORWARD_TWO');
		await waitForText(page, '#probe-memo-component', (text) =>
			text.includes('MEMO_TWO')
		);
		await expectCountKept(page);
	}, 90_000);

	test('a render error shows the overlay, and the fix recovers without a reload', async () => {
		const { hmr, page } = await openCounted();

		mutateFile(APP, (text) =>
			text.replace(
				'const [count, setCount] = useState(initialCount);',
				"const [count, setCount] = useState(initialCount);\n\tif (count >= 0) throw new Error('PROBE_RENDER_ERROR');"
			)
		);
		await hmr.waitFor('react-update', UPDATE_TIMEOUT_MS);
		await page.waitForSelector(OVERLAY, { timeout: UPDATE_TIMEOUT_MS });
		expect(await page.textContent(OVERLAY)).toContain('PROBE_RENDER_ERROR');

		hmr.drain();
		mutateFile(APP, (text) =>
			text
				.replace(
					"\n\tif (count >= 0) throw new Error('PROBE_RENDER_ERROR');",
					''
				)
				.replace(HEADING, '<h1>AbsoluteJS + React RECOVERED</h1>')
		);
		await waitForUpdate(hmr, page, 'main h1', 'RECOVERED');
		await page.waitForSelector(OVERLAY, {
			state: 'detached',
			timeout: UPDATE_TIMEOUT_MS
		});
		expect(await documentKept(page)).toBe(true);
	}, 90_000);

	test('a syntax error recovers once fixed', async () => {
		const { hmr, page } = await openCounted();

		mutateFile(APP, (text) =>
			text.replace(HEADING, '<h1>AbsoluteJS + React {{ BROKEN</h1>')
		);
		await page.waitForSelector(OVERLAY, { timeout: UPDATE_TIMEOUT_MS });

		hmr.drain();
		mutateFile(APP, (text) =>
			text.replace(
				'<h1>AbsoluteJS + React {{ BROKEN</h1>',
				'<h1>AbsoluteJS + React SYNTAX_FIXED</h1>'
			)
		);
		await waitForUpdate(hmr, page, 'main h1', 'SYNTAX_FIXED');
		await page.waitForSelector(OVERLAY, {
			state: 'detached',
			timeout: UPDATE_TIMEOUT_MS
		});
		await expectCountKept(page);
	}, 90_000);

	test('editing a non-component module updates the components that import it', async () => {
		const util = resolve(REACT_DIR, 'utils/probeFormat.ts');
		createFile(
			util,
			'export const probeFormat = (value: number) => `UTIL_ONE_${value}`;\n'
		);
		importIntoApp('../utils/probeFormat', 'probeFormat');
		renderInApp('<p id="probe-util">{probeFormat(count)}</p>');
		const { hmr, page } = await openCounted();
		expect(await page.textContent('#probe-util')).toBe(
			`UTIL_ONE_${CLICKS}`
		);

		mutateFile(util, (text) => text.replace('UTIL_ONE', 'UTIL_TWO'));
		await waitForUpdate(hmr, page, '#probe-util', `UTIL_TWO_${CLICKS}`);
		await expectCountKept(page);
	}, 90_000);

	test('a new component file imported by the page appears', async () => {
		const { hmr, page } = await openCounted();

		createFile(
			resolve(REACT_DIR, 'components/ProbeNew.tsx'),
			"export const ProbeNew = () => <aside id=\"probe-new\">{'NEW_COMPONENT_OK'}</aside>;\n"
		);
		mutateFile(PAGE, (text) =>
			text
				.replace(
					"import { App } from '../components/App';",
					"import { App } from '../components/App';\nimport { ProbeNew } from '../components/ProbeNew';"
				)
				.replace(
					'<App initialCount={initialCount} />',
					'<App initialCount={initialCount} />\n\t\t\t<ProbeNew />'
				)
		);
		await waitForUpdate(hmr, page, 'body', 'NEW_COMPONENT_OK');
		await expectCountKept(page);
	}, 90_000);

	test('a class component edit applies (remounted, document kept)', async () => {
		const legacy = resolve(REACT_DIR, 'components/ProbeClass.tsx');
		createFile(
			legacy,
			[
				"import { Component } from 'react';",
				'',
				'export class ProbeClass extends Component<object, { hits: number }> {',
				'\toverride state = { hits: 0 };',
				'',
				'\toverride render() {',
				'\t\treturn (',
				'\t\t\t<button',
				'\t\t\t\tid="probe-class"',
				'\t\t\t\tonClick={() => this.setState({ hits: this.state.hits + 1 })}',
				'\t\t\t\ttype="button"',
				'\t\t\t>',
				'\t\t\t\t{`CLASS_ONE hits ${this.state.hits}`}',
				'\t\t\t</button>',
				'\t\t);',
				'\t}',
				'}',
				''
			].join('\n')
		);
		importIntoApp('./ProbeClass', 'ProbeClass');
		renderInApp('<div><ProbeClass /></div>');
		const { hmr, page } = await openCounted();
		await page.click('#probe-class');
		await waitForText(page, '#probe-class', (text) =>
			text.includes('CLASS_ONE hits 1')
		);

		mutateFile(legacy, (text) => text.replace('CLASS_ONE', 'CLASS_TWO'));
		// Fast Refresh always remounts class components, so their state
		// resets; the document and sibling function state stay.
		await waitForUpdate(hmr, page, '#probe-class', 'CLASS_TWO');
		expect(await page.textContent('#probe-class')).toBe(
			'CLASS_TWO hits 0'
		);
		await expectCountKept(page);
	}, 90_000);
});

/* These hold on any Bun: with Fast Refresh the edit is swapped in place, on
 * stock Bun the page is remounted from its module. Either way no reload. */
describe('React browser updates', () => {
	test('a fresh load after an edit hydrates the edited page', async () => {
		const { hmr, page, srv } = await openCounted();
		mutateFile(APP, (text) =>
			text.replace(HEADING, '<h1>AbsoluteJS + React FRESH_LOAD</h1>')
		);
		await waitForUpdate(hmr, page, 'main h1', 'FRESH_LOAD');

		await session?.close();
		session = await openReadyPage(`${srv.baseUrl}/react`, async (next) => {
			await waitForText(
				next,
				COUNT_BUTTON,
				(text) => /count is \d+/.test(text),
				UPDATE_TIMEOUT_MS
			);
		});
		const fresh = session.page;
		const errors: string[] = [];
		fresh.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		expect(await fresh.textContent('main h1')).toContain('FRESH_LOAD');
		// Hydrated and interactive: the counter responds.
		await fresh.click(COUNT_BUTTON);
		await waitForText(fresh, COUNT_BUTTON, (text) =>
			text.includes('count is 1')
		);
		expect(await fresh.textContent('main h1')).toContain('FRESH_LOAD');
		expect(
			errors.filter((text) => /hydrat|did not match/i.test(text))
		).toEqual([]);
	}, 90_000);

	test('CSS imported by a React component propagates', async () => {
		const css = resolve(REACT_DIR, 'components/ProbeStyles.css');
		createFile(css, '.probe-css { color: rgb(1, 2, 3); }\n');
		mutateFile(APP, (text) =>
			text.replace(
				"import { useState } from 'react';",
				"import { useState } from 'react';\nimport './ProbeStyles.css';"
			)
		);
		renderInApp('<p className="probe-css" id="probe-css">styled</p>');
		const { hmr, page } = await openCounted();
		const colorIs = (expected: string) =>
			page.waitForFunction(
				(color) => {
					const element = document.getElementById('probe-css');

					return (
						element !== null &&
						getComputedStyle(element).color === color
					);
				},
				expected,
				{ timeout: UPDATE_TIMEOUT_MS }
			);
		await colorIs('rgb(1, 2, 3)');

		mutateFile(css, (text) => text.replace('rgb(1, 2, 3)', 'rgb(4, 5, 6)'));
		await hmr.waitFor('react-update', UPDATE_TIMEOUT_MS);
		await colorIs('rgb(4, 5, 6)');
		await expectAppliedInPlace(page);
	}, 90_000);

	test('a child edit keeps the page structure around it', async () => {
		const { hmr, page } = await openCounted();
		mutateFile(APP, (text) =>
			text.replace(HEADING, '<h1>AbsoluteJS + React STRUCTURE</h1>')
		);
		await waitForUpdate(hmr, page, 'main h1', 'STRUCTURE');
		// The page's own markup (header, dropdown) is still rendered: the
		// child was not rendered in the page's place.
		expect(await page.locator('header summary').textContent()).toBe(
			'Pages'
		);
		expect(await documentKept(page)).toBe(true);
	}, 90_000);
});
