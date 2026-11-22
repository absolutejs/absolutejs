import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

const { hideErrorOverlay, showErrorOverlay } =
	await import('../../../src/dev/client/errorOverlay');

type FrameLine = {
	caretColumn?: number;
	isError: boolean;
	number: number;
	text: string;
};
type Frame = { lines: FrameLine[] };
type FetchCall = { body: unknown; url: string };

/* The rendered half. The server reads the lines; this is what the person
 * actually sees, and the two things easiest to get silently wrong are the
 * caret's horizontal position and whether the location is clickable at
 * all. */

const overlayText = () => document.body.textContent ?? '';

const frameLines = () => {
	const pres = Array.from(document.querySelectorAll('pre'));

	return pres.flatMap((pre) =>
		Array.from(pre.children).map((child) => child.textContent ?? '')
	);
};

beforeEach(() => {
	hideErrorOverlay();
	document.body.innerHTML = '';
});

afterAll(async () => {
	hideErrorOverlay();
	/* The unit runner shares one process across files, so a registered
	 * DOM outlives this file and reaches every test that sorts after it.
	 * Leaving it registered broke 11 i18n tests that do not expect a
	 * `document` to exist. */
	await GlobalRegistrator.unregister();
});

describe('the overlay code frame', () => {
	const frame: Frame = {
		lines: [
			{ isError: false, number: 8, text: 'const a = 1;' },
			{ caretColumn: 10, isError: true, number: 9, text: 'const b = ;' },
			{ isError: false, number: 10, text: 'const c = 3;' }
		]
	};

	test('renders every line with its real file line number', () => {
		showErrorOverlay({
			codeFrame: frame,
			file: 'react/pages/Home.tsx',
			kind: 'compilation',
			line: 9,
			message: 'Unexpected ;'
		});

		const rendered = frameLines().join('\n');
		expect(rendered).toContain('8 | const a = 1;');
		expect(rendered).toContain('9 | const b = ;');
		expect(rendered).toContain('10 | const c = 3;');
	});

	test('marks the error line and only the error line', () => {
		showErrorOverlay({
			codeFrame: frame,
			file: 'react/pages/Home.tsx',
			kind: 'compilation',
			message: 'Unexpected ;'
		});

		const marked = frameLines().filter((line) => line.startsWith('>'));
		expect(marked.length).toBe(1);
		expect(marked[0]).toContain('const b = ;');
	});

	/* The caret has to sit under the reported column. Counted against the
	 * gutter the same way the eye does: everything before the `|`, then
	 * `caretColumn` characters. */
	test('puts the caret under the offending character', () => {
		showErrorOverlay({
			codeFrame: frame,
			file: 'react/pages/Home.tsx',
			kind: 'compilation',
			message: 'Unexpected ;'
		});

		const lines = frameLines();
		const errorIndex = lines.findIndex((line) => line.startsWith('>'));
		const errorLine = lines[errorIndex] ?? '';
		const caretLine = lines[errorIndex + 1] ?? '';

		/* A caret row: gutter, pipe, padding, one `^` and nothing else. */
		expect(caretLine).toMatch(/^ +\| +\^$/u);
		/* And it lands on the same column as the `;` it points at. */
		expect(caretLine.indexOf('^')).toBe(errorLine.indexOf(';'));
	});

	/* Bun's BuildMessage carries only the one line, so that stays the
	 * fallback when no frame could be read — a deleted or unreadable file,
	 * say. */
	test('falls back to the single line when there is no frame', () => {
		showErrorOverlay({
			file: 'react/pages/Home.tsx',
			kind: 'compilation',
			line: 9,
			lineText: 'const b = ;',
			message: 'Unexpected ;'
		});

		expect(overlayText()).toContain('const b = ;');
		expect(frameLines().some((line) => line.includes('|'))).toBe(false);
	});
});

describe('the open-in-editor control', () => {
	test('is a button when there is a file to open', () => {
		showErrorOverlay({
			column: 11,
			file: 'react/pages/Home.tsx',
			kind: 'compilation',
			line: 9,
			message: 'Unexpected ;'
		});

		const buttons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').includes('Open in editor')
		);
		expect(buttons.length).toBe(1);
		expect(buttons[0]?.textContent).toContain('react/pages/Home.tsx:9:11');
	});

	/* A button that cannot do anything is worse than a label. */
	test('is not a button when there is no file', () => {
		showErrorOverlay({
			kind: 'runtime',
			message: 'Something failed with no location'
		});

		const buttons = Array.from(document.querySelectorAll('button')).filter(
			(button) => (button.textContent ?? '').includes('Open in editor')
		);
		expect(buttons.length).toBe(0);
	});

	test('posts the file, line and column to the dev server', async () => {
		const calls: FetchCall[] = [];
		const original = globalThis.fetch;
		/* `typeof fetch` carries a `preconnect` property in Bun's lib, so
		 * the stub is assembled rather than asserted into shape. */
		const stub: typeof fetch = Object.assign(
			async (url: RequestInfo | URL, init?: RequestInit) => {
				calls.push({
					body: JSON.parse(String(init?.body ?? 'null')),
					url: String(url)
				});

				return new Response(JSON.stringify({ ok: true }), {
					status: 200
				});
			},
			{ preconnect: original.preconnect }
		);
		globalThis.fetch = stub;

		try {
			showErrorOverlay({
				column: 11,
				file: 'react/pages/Home.tsx',
				kind: 'compilation',
				line: 9,
				message: 'Unexpected ;'
			});
			const button = Array.from(document.querySelectorAll('button')).find(
				(candidate) =>
					(candidate.textContent ?? '').includes('Open in editor')
			);
			button?.dispatchEvent(new Event('click'));
			await Bun.sleep(20);

			expect(calls.length).toBe(1);
			expect(calls[0]?.url).toBe('/_absolute/open-in-editor');
			expect(calls[0]?.body).toEqual({
				column: 11,
				file: 'react/pages/Home.tsx',
				line: 9
			});
		} finally {
			globalThis.fetch = original;
		}
	});

	/* "No editor configured" is a thing the person can fix, so it has to
	 * reach them rather than being swallowed. */
	test('shows the reason when the server refuses', async () => {
		const original = globalThis.fetch;
		const stub: typeof fetch = Object.assign(
			async () =>
				new Response(
					JSON.stringify({
						ok: false,
						reason: 'No editor configured. Set $EDITOR'
					}),
					{ status: 501 }
				),
			{ preconnect: original.preconnect }
		);
		globalThis.fetch = stub;

		try {
			showErrorOverlay({
				file: 'react/pages/Home.tsx',
				kind: 'compilation',
				line: 9,
				message: 'Unexpected ;'
			});
			const button = Array.from(document.querySelectorAll('button')).find(
				(candidate) =>
					(candidate.textContent ?? '').includes('Open in editor')
			);
			button?.dispatchEvent(new Event('click'));
			await Bun.sleep(20);

			expect(button?.title).toContain('$EDITOR');
		} finally {
			globalThis.fetch = original;
		}
	});
});
