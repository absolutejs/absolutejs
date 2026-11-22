import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startDevServer, type DevServer } from '../../../helpers/devServer';
import { mutateFile, restoreAllFiles } from '../../../helpers/file';
import { connectHMR, type HMRClient } from '../../../helpers/ws';

/* The overlay knew the file, line and column and printed them as text,
 * with at most the single offending line underneath — which is what Bun's
 * `BuildMessage.position` carries, and often the least informative line in
 * the file. There was nothing to click and nothing to count from.
 *
 * Both halves are checked here against a real dev server: the frame has to
 * be read on the server (the browser cannot read the filesystem), and the
 * editor is launched by the server too. A fake editor that records its
 * argv is how the second half is observable at all. */

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const PAGE = resolve(PROJECT_ROOT, 'example/react/components/App.tsx');
const SCRATCH = join(PROJECT_ROOT, '.hmr-temp');

let server: DevServer;
let client: HMRClient;

beforeAll(async () => {
	server = await startDevServer();
	client = await connectHMR(server.port);
});

afterAll(async () => {
	restoreAllFiles();
	client.close();
	await server.kill();
});

describe('the error overlay code frame', () => {
	test('a build failure carries the lines around the error', async () => {
		client.drain();
		/* A syntax error, so the transform fails with a position rather
		 * than the build succeeding and the page erroring at runtime. */
		mutateFile(PAGE, (content) =>
			content.replace('export', 'export const =;\nexport')
		);

		const message = await client.waitFor('rebuild-error', 60_000);
		const data = Reflect.get(message, 'data');
		expect(data).toBeDefined();
		const frame = Reflect.get(Object(data), 'codeFrame');
		expect(frame).toBeDefined();

		const lines: { isError: boolean; number: number; text: string }[] =
			Reflect.get(Object(frame), 'lines');
		expect(Array.isArray(lines)).toBe(true);
		/* More than one line is the whole point: a frame, not an excerpt. */
		expect(lines.length).toBeGreaterThan(1);

		const errorLine = lines.filter((entry) => entry.isError);
		expect(errorLine.length).toBe(1);

		/* The numbers are real file line numbers, consecutive, and the
		 * text matches what is on disk at those numbers. */
		const onDisk = readFileSync(PAGE, 'utf-8').split('\n');
		for (const entry of lines)
			expect(entry.text).toBe(onDisk[entry.number - 1] ?? '');
		const numbers = lines.map((entry) => entry.number);
		expect(numbers).toEqual(
			numbers.map((_, index) => (numbers[0] ?? 0) + index)
		);

		restoreAllFiles();
		await client.waitFor('react-update', 60_000).catch(() => undefined);
	}, 180_000);
});

describe('open in editor', () => {
	const recorder = join(SCRATCH, 'fake-editor.sh');
	const argvLog = join(SCRATCH, 'editor-argv.txt');

	const post = (body: unknown) =>
		fetch(`${server.baseUrl}/_absolute/open-in-editor`, {
			body: JSON.stringify(body),
			headers: { 'Content-Type': 'application/json' },
			method: 'POST'
		});

	test('refuses a path outside the project', async () => {
		const response = await post({ file: '../../../../etc/passwd' });

		expect(response.status).toBe(400);
		const payload: { reason?: string } = await response.json();
		expect(payload.reason).toMatch(/outside the project/u);
	});

	test('refuses a file that does not exist', async () => {
		const response = await post({ file: 'example/react/pages/Nope.tsx' });

		expect(response.status).toBe(400);
		const payload: { reason?: string } = await response.json();
		expect(payload.reason).toMatch(/No such file/u);
	});

	test('rejects a request with no file', async () => {
		const response = await post({ line: 12 });

		expect(response.status).toBe(400);
	});

	/* With no editor configured it says which variable to set rather than
	 * guessing at an installed editor and launching the wrong thing. */
	test('says what to set when no editor is configured', async () => {
		const { openInEditor } =
			await import('../../../../src/dev/openInEditor');
		const previous: Record<string, string | undefined> = {
			ABSOLUTE_EDITOR: process.env.ABSOLUTE_EDITOR,
			EDITOR: process.env.EDITOR,
			LAUNCH_EDITOR: process.env.LAUNCH_EDITOR
		};
		delete process.env.ABSOLUTE_EDITOR;
		delete process.env.EDITOR;
		delete process.env.LAUNCH_EDITOR;
		try {
			const result = openInEditor({
				file: 'example/react/components/App.tsx',
				line: 1,
				projectRoot: PROJECT_ROOT
			});

			expect(result.ok).toBe(false);
			expect(result.ok === false && result.reason).toMatch(
				/\$EDITOR|ABSOLUTE_EDITOR/u
			);
		} finally {
			Object.assign(process.env, previous);
		}
	});

	/* The observable half: a recorded argv proves the file reached the
	 * editor, and proves the path was passed as one argument rather than
	 * through a shell. */
	test('launches the configured editor with the file and line', async () => {
		const { openInEditor } =
			await import('../../../../src/dev/openInEditor');
		writeFileSync(
			recorder,
			`#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvLog)}\n`
		);
		chmodSync(recorder, 0o755);
		writeFileSync(argvLog, '');

		const previous = process.env.ABSOLUTE_EDITOR;
		process.env.ABSOLUTE_EDITOR = recorder;
		try {
			const result = openInEditor({
				column: 7,
				file: 'example/react/components/App.tsx',
				line: 42,
				projectRoot: PROJECT_ROOT
			});
			expect(result.ok).toBe(true);

			let recorded = '';
			for (let attempt = 0; attempt < 50 && !recorded; attempt += 1) {
				await Bun.sleep(50);
				recorded = readFileSync(argvLog, 'utf-8');
			}

			const argv = recorded.trim().split('\n');
			expect(argv.at(-1)).toBe(PAGE);
		} finally {
			if (previous === undefined) delete process.env.ABSOLUTE_EDITOR;
			else process.env.ABSOLUTE_EDITOR = previous;
		}
	}, 30_000);
});
