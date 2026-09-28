import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import {
	createFile,
	mutateFile,
	mutateFileInPlace,
	restoreAllFiles
} from '../../../helpers/file';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const REACT_DIR = resolve(PROJECT_ROOT, 'example/react');
const APP = resolve(REACT_DIR, 'components/App.tsx');
const PAGE = resolve(REACT_DIR, 'pages/ReactExample.tsx');
const HEADING = '<h1>AbsoluteJS + React</h1>';
const SSR_TIMEOUT_MS = 20_000;

let server: DevServer | undefined;
let client: HMRClient | undefined;

afterEach(async () => {
	client?.close();
	client = undefined;
	await server?.kill();
	server = undefined;
	restoreAllFiles();
});

const startAndConnect = async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
	await client.waitFor('manifest');
	await client.waitFor('connected');
	client.drain();

	return { hmr: client, srv: server };
};

/* React SSR separates adjacent text nodes with `<!-- -->`; strip them so
 * assertions read like the rendered text. */
const readableHtml = (html: string) => html.replaceAll('<!-- -->', '');

/* The server entry imports React pages directly and runs under `bun --hot`,
 * so SSR catches up when Bun re-evaluates the edited module graph. There is
 * no broadcast for that moment, so poll the page (bounded) until the marker
 * appears, and hand back the last HTML either way for the assertion. */
const fetchSsrUntil = async (
	srv: DevServer,
	predicate: (html: string) => boolean
) => {
	const deadline = Date.now() + SSR_TIMEOUT_MS;
	let html = '';
	while (Date.now() < deadline) {
		html = readableHtml(await (await fetch(`${srv.baseUrl}/react`)).text());
		if (predicate(html)) return html;
		await Bun.sleep(100);
	}

	return html;
};

const editAndFetch = async (
	hmr: HMRClient,
	srv: DevServer,
	marker: string,
	edit: () => void
) => {
	hmr.drain();
	edit();
	await hmr.waitFor('react-update', 15_000);

	return fetchSsrUntil(srv, (html) => html.includes(marker));
};

const addToApp = (markup: string, prelude = '') =>
	mutateFile(APP, (text) =>
		text
			.replace(
				'const [count, setCount] = useState(initialCount);',
				`const [count, setCount] = useState(initialCount);\n${prelude}`
			)
			.replace(HEADING, `${HEADING}\n\t\t\t${markup}`)
	);

/* Deep React HMR coverage (server-rendered half). Each test edits one React
 * feature, waits for the `react-update` broadcast, and asserts that a fresh
 * request's SSR HTML reflects the change. None of this depends on React Fast
 * Refresh, so it runs on stock Bun too; the browser half lives in
 * react-fast-refresh-coverage.test.ts. Each test gets its own dev server so
 * transform caches and watcher hashes cannot bleed between cases. */
describe('React deep coverage (SSR)', () => {
	test('`useState` initial value change reaches SSR', async () => {
		const { hmr, srv } = await startAndConnect();
		const html = await editAndFetch(hmr, srv, 'count is 999', () =>
			mutateFile(APP, (text) =>
				text.replace(
					'useState(initialCount);',
					'useState(initialCount + 999);'
				)
			)
		);
		expect(html).toContain('count is 999');
	}, 60_000);

	test('`useMemo` / `useCallback` body change reaches SSR, twice in a row', async () => {
		const { hmr, srv } = await startAndConnect();
		mutateFile(APP, (text) =>
			text.replace(
				"import { useState } from 'react';",
				"import { useCallback, useMemo, useState } from 'react';"
			)
		);
		const first = await editAndFetch(hmr, srv, 'MEMO_7_CB_7', () =>
			addToApp(
				'<p>{`MEMO_${tripled}_${label()}`}</p>',
				'\tconst tripled = useMemo(() => count * 3 + 7, [count]);\n\tconst label = useCallback(() => `CB_${tripled}`, [tripled]);'
			)
		);
		expect(first).toContain('MEMO_7_CB_7');

		// A second edit to the same file must rebuild too.
		const second = await editAndFetch(hmr, srv, 'MEMO_11_CB_11', () =>
			mutateFile(APP, (text) =>
				text.replace('count * 3 + 7', 'count * 3 + 11')
			)
		);
		expect(second).toContain('MEMO_11_CB_11');
	}, 60_000);

	test('context provider value change reaches the consumer in SSR', async () => {
		const { hmr, srv } = await startAndConnect();
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
				'\treturn <p data-probe-theme>{`THEME_${theme}`}</p>;',
				'};',
				''
			].join('\n')
		);
		const first = await editAndFetch(hmr, srv, 'THEME_CTX_ONE', () =>
			mutateFile(APP, (text) =>
				text
					.replace(
						"import { useState } from 'react';",
						"import { useState } from 'react';\nimport { ProbeThemeBadge, ProbeThemeContext } from './ProbeTheme';"
					)
					.replace(
						HEADING,
						`${HEADING}\n\t\t\t<ProbeThemeContext.Provider value="CTX_ONE">\n\t\t\t\t<ProbeThemeBadge />\n\t\t\t</ProbeThemeContext.Provider>`
					)
			)
		);
		expect(first).toContain('THEME_CTX_ONE');

		const second = await editAndFetch(hmr, srv, 'THEME_CTX_TWO', () =>
			mutateFile(APP, (text) =>
				text.replace('value="CTX_ONE"', 'value="CTX_TWO"')
			)
		);
		expect(second).toContain('THEME_CTX_TWO');
		expect(second).not.toContain('THEME_NO_PROVIDER');
	}, 60_000);

	test('custom hook body change propagates through its importing component', async () => {
		const { hmr, srv } = await startAndConnect();
		const hook = resolve(REACT_DIR, 'hooks/useProbeLabel.ts');
		createFile(
			hook,
			[
				"import { useState } from 'react';",
				'',
				"export const useProbeLabel = () => useState('HOOK_ONE')[0];",
				''
			].join('\n')
		);
		const first = await editAndFetch(hmr, srv, 'LABEL_HOOK_ONE', () =>
			mutateFile(APP, (text) =>
				text
					.replace(
						"import { useState } from 'react';",
						"import { useState } from 'react';\nimport { useProbeLabel } from '../hooks/useProbeLabel';"
					)
					.replace(
						'const [count, setCount] = useState(initialCount);',
						'const [count, setCount] = useState(initialCount);\n\tconst probeLabel = useProbeLabel();'
					)
					.replace(
						HEADING,
						`${HEADING}\n\t\t\t<p>{\`LABEL_\${probeLabel}\`}</p>`
					)
			)
		);
		expect(first).toContain('LABEL_HOOK_ONE');

		const second = await editAndFetch(hmr, srv, 'LABEL_HOOK_TWO', () =>
			mutateFile(hook, (text) => text.replace('HOOK_ONE', 'HOOK_TWO'))
		);
		expect(second).toContain('LABEL_HOOK_TWO');
	}, 60_000);

	test('new prop on a child component is consumed from the parent', async () => {
		const { hmr, srv } = await startAndConnect();
		const html = await editAndFetch(hmr, srv, 'TAG_NEW_PROP_OK', () => {
			mutateFile(APP, (text) =>
				text
					.replace(
						'type AppProps = { initialCount: number };',
						'type AppProps = { initialCount: number; tag?: string };'
					)
					.replace(
						'({ initialCount }: AppProps)',
						'({ initialCount, tag }: AppProps)'
					)
					.replace(
						HEADING,
						`${HEADING}\n\t\t\t<p>{\`TAG_\${tag ?? 'NONE'}\`}</p>`
					)
			);
			mutateFile(PAGE, (text) =>
				text.replace(
					'<App initialCount={initialCount} />',
					'<App initialCount={initialCount} tag="NEW_PROP_OK" />'
				)
			);
		});
		expect(html).toContain('TAG_NEW_PROP_OK');
	}, 60_000);

	test('conditional-render edit toggles which branch renders', async () => {
		const { hmr, srv } = await startAndConnect();
		const first = await editAndFetch(hmr, srv, 'BRANCH_LOW', () =>
			addToApp('{count > 100 ? <p>BRANCH_HIGH</p> : <p>BRANCH_LOW</p>}')
		);
		expect(first).toContain('BRANCH_LOW');
		expect(first).not.toContain('BRANCH_HIGH');

		const second = await editAndFetch(hmr, srv, 'BRANCH_HIGH', () =>
			mutateFile(APP, (text) =>
				text.replace('count > 100 ?', 'count >= 0 ?')
			)
		);
		expect(second).toContain('BRANCH_HIGH');
		expect(second).not.toContain('BRANCH_LOW');
	}, 60_000);

	test('list rendering renders every item', async () => {
		const { hmr, srv } = await startAndConnect();
		const html = await editAndFetch(hmr, srv, 'ITEM_gamma', () =>
			addToApp(
				"<ul>{['alpha', 'beta', 'gamma'].map((item) => <li key={item}>{`ITEM_${item}`}</li>)}</ul>"
			)
		);
		expect(html).toContain('ITEM_alpha');
		expect(html).toContain('ITEM_beta');
		expect(html).toContain('ITEM_gamma');
	}, 60_000);

	test('`React.memo` and `forwardRef` component edits reach SSR', async () => {
		const { hmr, srv } = await startAndConnect();
		const wrapped = resolve(REACT_DIR, 'components/ProbeWrapped.tsx');
		createFile(
			wrapped,
			[
				"import { forwardRef, memo } from 'react';",
				'',
				'export const ProbeMemo = memo(function ProbeMemo() {',
				"\treturn <p>{'MEMO_ONE'}</p>;",
				'});',
				'',
				'export const ProbeForward = forwardRef<HTMLParagraphElement>(',
				'\tfunction ProbeForward(_props, ref) {',
				"\t\treturn <p ref={ref}>{'FORWARD_ONE'}</p>;",
				'\t}',
				');',
				''
			].join('\n')
		);
		const first = await editAndFetch(hmr, srv, 'FORWARD_ONE', () =>
			mutateFile(APP, (text) =>
				text
					.replace(
						"import { useState } from 'react';",
						"import { useState } from 'react';\nimport { ProbeForward, ProbeMemo } from './ProbeWrapped';"
					)
					.replace(
						HEADING,
						`${HEADING}\n\t\t\t<ProbeMemo />\n\t\t\t<ProbeForward />`
					)
			)
		);
		expect(first).toContain('MEMO_ONE');
		expect(first).toContain('FORWARD_ONE');

		const second = await editAndFetch(hmr, srv, 'FORWARD_TWO', () =>
			mutateFile(wrapped, (text) =>
				text
					.replace('MEMO_ONE', 'MEMO_TWO')
					.replace('FORWARD_ONE', 'FORWARD_TWO')
			)
		);
		expect(second).toContain('MEMO_TWO');
		expect(second).toContain('FORWARD_TWO');
	}, 60_000);

	test('editing a non-component module propagates to its importers', async () => {
		const { hmr, srv } = await startAndConnect();
		const util = resolve(REACT_DIR, 'utils/probeFormat.ts');
		createFile(
			util,
			'export const probeFormat = (value: number) => `UTIL_ONE_${value}`;\n'
		);
		const first = await editAndFetch(hmr, srv, 'UTIL_ONE_0', () =>
			mutateFile(APP, (text) =>
				text
					.replace(
						"import { useState } from 'react';",
						"import { useState } from 'react';\nimport { probeFormat } from '../utils/probeFormat';"
					)
					.replace(
						HEADING,
						`${HEADING}\n\t\t\t<p>{probeFormat(count)}</p>`
					)
			)
		);
		expect(first).toContain('UTIL_ONE_0');

		hmr.drain();
		mutateFile(util, (text) => text.replace('UTIL_ONE', 'UTIL_TWO'));
		const update = await hmr.waitFor('react-update', 15_000);
		const data = update.data as Record<string, unknown>;
		// The utility has no component of its own: the broadcast points the
		// browser at the nearest importing component.
		expect(String(data.pageModuleUrl)).toContain('App.tsx');
		const second = await fetchSsrUntil(srv, (html) =>
			html.includes('UTIL_TWO_0')
		);
		expect(second).toContain('UTIL_TWO_0');
	}, 60_000);

	test('a new component file imported by the page renders', async () => {
		const { hmr, srv } = await startAndConnect();
		const html = await editAndFetch(hmr, srv, 'NEW_COMPONENT_OK', () => {
			createFile(
				resolve(REACT_DIR, 'components/ProbeNew.tsx'),
				"export const ProbeNew = () => <aside>{'NEW_COMPONENT_OK'}</aside>;\n"
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
		});
		expect(html).toContain('NEW_COMPONENT_OK');
	}, 60_000);

	test('a class component edit reaches SSR', async () => {
		const { hmr, srv } = await startAndConnect();
		const legacy = resolve(REACT_DIR, 'components/ProbeClass.tsx');
		createFile(
			legacy,
			[
				"import { Component } from 'react';",
				'',
				'export class ProbeClass extends Component {',
				'\toverride render() {',
				"\t\treturn <p>{'CLASS_ONE'}</p>;",
				'\t}',
				'}',
				''
			].join('\n')
		);
		const first = await editAndFetch(hmr, srv, 'CLASS_ONE', () =>
			mutateFile(APP, (text) =>
				text
					.replace(
						"import { useState } from 'react';",
						"import { useState } from 'react';\nimport { ProbeClass } from './ProbeClass';"
					)
					.replace(HEADING, `${HEADING}\n\t\t\t<ProbeClass />`)
			)
		);
		expect(first).toContain('CLASS_ONE');

		const second = await editAndFetch(hmr, srv, 'CLASS_TWO', () =>
			mutateFile(legacy, (text) => text.replace('CLASS_ONE', 'CLASS_TWO'))
		);
		expect(second).toContain('CLASS_TWO');
	}, 60_000);

	test('in-place writes to the same file each rebuild', async () => {
		const { hmr, srv } = await startAndConnect();
		const first = await editAndFetch(hmr, srv, 'IN_PLACE_ONE', () =>
			mutateFileInPlace(APP, (text) =>
				text.replace(
					HEADING,
					'<h1>AbsoluteJS + React IN_PLACE_ONE</h1>'
				)
			)
		);
		expect(first).toContain('IN_PLACE_ONE');

		const second = await editAndFetch(hmr, srv, 'IN_PLACE_TWO', () =>
			mutateFileInPlace(APP, (text) =>
				text.replace('IN_PLACE_ONE', 'IN_PLACE_TWO')
			)
		);
		expect(second).toContain('IN_PLACE_TWO');
	}, 60_000);

	test('a syntax error is reported, and later edits still rebuild', async () => {
		const { hmr, srv } = await startAndConnect();
		// The server entry imports React pages, so a broken component also
		// fails Bun's hot reload of the server. That used to stop every
		// timer in the dev server, and with them all later rebuilds.
		mutateFileInPlace(APP, (text) =>
			text.replace(HEADING, '<h1>AbsoluteJS + React {{ BROKEN</h1>')
		);
		const error = await hmr.waitFor('rebuild-error', 15_000);
		const data = error.data as Record<string, unknown>;
		expect(String(data.file)).toContain('App.tsx');
		expect(data.line).toBe(26);

		const fixed = await editAndFetch(hmr, srv, 'SYNTAX_FIXED', () =>
			mutateFileInPlace(APP, (text) =>
				text.replace(
					'<h1>AbsoluteJS + React {{ BROKEN</h1>',
					'<h1>AbsoluteJS + React SYNTAX_FIXED</h1>'
				)
			)
		);
		expect(fixed).toContain('SYNTAX_FIXED');

		const again = await editAndFetch(hmr, srv, 'STILL_LIVE', () =>
			mutateFileInPlace(APP, (text) =>
				text.replace('SYNTAX_FIXED', 'STILL_LIVE')
			)
		);
		expect(again).toContain('STILL_LIVE');
	}, 60_000);
});
