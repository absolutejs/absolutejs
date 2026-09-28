import { afterEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runtimeSupportsReactFastRefresh } from '../../../../src/cli/patchedBun';
import {
	openReadyPage,
	type BrowserSession,
	waitForText
} from '../../../helpers/browser';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const APP = resolve(PROJECT_ROOT, 'example/react/components/App.tsx');
const PAGE = resolve(PROJECT_ROOT, 'example/react/pages/ReactExample.tsx');
const COUNT_BUTTON = 'main button';
const CLICKS = 7;

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
 * Bun.Transpiler (oven-sh/bun#32919), so these only mean something on a Bun
 * with the fix. Run them with AbsoluteJS's patched Bun:
 *   ~/.absolutejs/bun/<release>/<platform>/bun test tests/integration/hmr/lifecycle/react-state-preservation.test.ts
 * BUN-REACT-REFRESH-LEGACY: drop the skip once the minimum Bun has the fix. */
const fastRefresh = runtimeSupportsReactFastRefresh();

const startCounted = async () => {
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
			15_000
		);
	});
	const { page } = session;
	const start = Number(
		(await page.textContent(COUNT_BUTTON))?.match(/count is (\d+)/)?.[1]
	);
	for (let click = 1; click <= CLICKS; click++) {
		await page.click(COUNT_BUTTON);
		await waitForText(page, COUNT_BUTTON, (text) =>
			text.includes(`count is ${start + click}`)
		);
	}
	// A full page reload would drop this; Fast Refresh keeps the document.
	await page.evaluate(() => {
		Reflect.set(window, '__reactHmrDocument', 'kept');
	});

	return { client, page, start };
};

const documentKept = (page: BrowserSession['page']) =>
	page.evaluate(() => Reflect.get(window, '__reactHmrDocument') === 'kept');

describe.skipIf(!fastRefresh)(
	'React Fast Refresh keeps component state',
	() => {
		test(
			'useState survives an edit to the component (no reload)',
			async () => {
				const { client: hmr, page, start } = await startCounted();
				hmr.drain();
				mutateFile(APP, (text) =>
					text.replace(
						'<h1>AbsoluteJS + React</h1>',
						'<h1>AbsoluteJS + React EDITED</h1>'
					)
				);
				await hmr.waitFor('react-update', 15_000);
				await waitForText(
					page,
					'main h1',
					(text) => text.includes('EDITED'),
					15_000
				);
				expect(await page.textContent(COUNT_BUTTON)).toContain(
					`count is ${start + CLICKS}`
				);
				expect(await documentKept(page)).toBe(true);
			},
			{ retry: 2, timeout: 90_000 }
		);

		test(
			'a changed hook signature resets that component, still without a reload',
			async () => {
				const { client: hmr, page, start } = await startCounted();
				hmr.drain();
				// Fast Refresh remounts a component whose hooks changed: its
				// state resets to the initial value, the document stays.
				mutateFile(APP, (text) =>
					text
						.replace(
							'const [count, setCount] = useState(initialCount);',
							'const [count, setCount] = useState(initialCount);\n\tconst [edited] = useState(true);'
						)
						.replace(
							'<h1>AbsoluteJS + React</h1>',
							'<h1>AbsoluteJS + React {edited ? "HOOKS" : ""}</h1>'
						)
				);
				await hmr.waitFor('react-update', 15_000);
				await waitForText(
					page,
					'main h1',
					(text) => text.includes('HOOKS'),
					15_000
				);
				expect(await page.textContent(COUNT_BUTTON)).toContain(
					`count is ${start}`
				);
				expect(await documentKept(page)).toBe(true);
			},
			{ retry: 2, timeout: 90_000 }
		);

		test(
			"editing the page keeps the child component's state",
			async () => {
				const { client: hmr, page, start } = await startCounted();
				hmr.drain();
				mutateFile(PAGE, (text) =>
					text.replace(
						'<a href="/">AbsoluteJS</a>',
						'<a href="/">AbsoluteJS PAGE_EDITED</a>'
					)
				);
				await hmr.waitFor('react-update', 15_000);
				await waitForText(
					page,
					'header',
					(text) => text.includes('PAGE_EDITED'),
					15_000
				);
				expect(await page.textContent(COUNT_BUTTON)).toContain(
					`count is ${start + CLICKS}`
				);
				expect(await documentKept(page)).toBe(true);
			},
			{ retry: 2, timeout: 90_000 }
		);
	}
);

describe.skipIf(fastRefresh)(
	'React edits on a Bun without Fast Refresh',
	() => {
		test(
			'still apply without a manual reload (remount fallback)',
			async () => {
				const { client: hmr, page } = await startCounted();
				hmr.drain();
				mutateFile(APP, (text) =>
					text.replace(
						'<h1>AbsoluteJS + React</h1>',
						'<h1>AbsoluteJS + React EDITED</h1>'
					)
				);
				await hmr.waitFor('react-update', 15_000);
				await waitForText(
					page,
					'main h1',
					(text) => text.includes('EDITED'),
					15_000
				);
			},
			{ retry: 2, timeout: 90_000 }
		);
	}
);
