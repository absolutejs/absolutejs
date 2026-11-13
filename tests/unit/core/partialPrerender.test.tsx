import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { Component } from 'svelte';
import {
	collectPartialHoles,
	PARTIAL_HOLES_HEADER,
	PARTIAL_SHELL_HEADER,
	readPartialHoles,
	writePartialHoles
} from '../../../src/core/partialPrerender';
import { servePartialPrerender } from '../../../src/core/partialPrerenderServe';
import {
	renderedNonce,
	writeRenderedNonce
} from '../../../src/core/prerenderNonce';
import {
	absoluteRequestContext,
	runWithAbsoluteRequest
} from '../../../src/core/requestContext';
import {
	disableCspNonces,
	enableCspNonces,
	getCspNonce
} from '../../../src/core/cspNonce';
import { StreamSlot, SuspenseSlot } from '../../../src/react/components';
import { handleReactPageRequest } from '../../../src/react';
import { handleSveltePageRequest } from '../../../src/svelte';

/* Partial prerendering: a pre-rendered page's static shell is served from
 * the cache at once; only its dynamic slots render per request, and they
 * stream into the shell already sent. */

const SLOW_HOLE_MS = 600;
const FIRST_BYTE_BUDGET_MS = 150;
const BYPASS = 'X-Absolute-Prerender-Bypass';

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});
afterEach(() => disableCspNonces());

type SlotCounts = { dynamic: number; static: number };

const counts: SlotCounts = { dynamic: 0, static: 0 };

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\w+)/)?.[1] ?? 'guest';

const ReactPartialPage = ({ user }: { user: string }) => (
	<html lang="en">
		<head>
			<title>Partial</title>
		</head>
		<body>
			<nav>static navigation</nav>
			<StreamSlot
				fallbackHtml="<p>static loading</p>"
				id="react-static"
				resolve={async () => {
					counts.static += 1;

					return '<section>static resolved</section>';
				}}
			/>
			<StreamSlot
				dynamic
				fallbackHtml="<p>greeting loading</p>"
				id="react-greeting"
				resolve={async () => {
					counts.dynamic += 1;
					await Bun.sleep(SLOW_HOLE_MS);

					return `<section>hello ${user}</section>`;
				}}
			/>
			<SuspenseSlot
				dynamic
				fallback={<p>cart loading</p>}
				id="react-cart"
				resolve={async () => `cart of ${user}`}
			>
				{(value: string) => <strong>{value}</strong>}
			</SuspenseSlot>
		</body>
	</html>
);

const SVELTE_PAGE = resolve(
	import.meta.dir,
	'..',
	'..',
	'fixtures',
	'svelte',
	'PartialPrerenderPage.svelte'
);

const reactApp = () =>
	new Elysia().use(absoluteRequestContext).get('/', ({ request }) =>
		handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/react-partial-index.js',
			Page: ReactPartialPage,
			props: { user: userFrom(request) }
		})
	);

const svelteApp = () =>
	new Elysia().use(absoluteRequestContext).get('/', ({ request }) =>
		handleSveltePageRequest<Component<{ user?: string }>>({
			collectStreamingSlots: true,
			indexPath: '/svelte-partial-index.js',
			pagePath: SVELTE_PAGE,
			props: { user: userFrom(request) }
		})
	);

type App = ReturnType<typeof reactApp> | ReturnType<typeof svelteApp>;

/* What `absolute start` does at build time: request the shell and store it
 * with its nonce and its holes. */
const captureShell = async (app: App) => {
	const response = await app.handle(
		new Request('http://localhost/', {
			headers: { [PARTIAL_SHELL_HEADER]: '1' }
		})
	);
	const dir = await mkdtemp(join(tmpdir(), 'absolute-partial-prerender-'));
	directories.push(dir);
	const filePath = join(dir, 'index.html');
	const html = await response.text();
	await Bun.write(filePath, html);
	await writeRenderedNonce(filePath, renderedNonce(response));
	await writePartialHoles(filePath, response);

	return { filePath, holesHeader: response.headers, html };
};

/* Reads a response chunk by chunk, timing the first byte. */
const readTimed = async (response: Response) => {
	const started = performance.now();
	const reader = response.body?.getReader();
	if (!reader) throw new Error('no body');
	const decoder = new TextDecoder();
	const first = await reader.read();
	const firstByteMs = performance.now() - started;
	const firstChunk = decoder.decode(first.value, { stream: true });
	const readRest = async (text: string): Promise<string> => {
		const next = await reader.read();
		if (next.done) return text;

		return readRest(text + decoder.decode(next.value, { stream: true }));
	};
	const text = await readRest(firstChunk);

	return {
		firstByteMs,
		firstChunk,
		text,
		totalMs: performance.now() - started
	};
};

type ServeSecurity = {
	nonce?: string;
	securityHeaders?: Record<string, string>;
};

const serve = (
	app: App,
	filePath: string,
	cookie: string,
	{ nonce, securityHeaders }: ServeSecurity = {}
) => {
	const request = new Request('http://localhost/', {
		headers: { cookie }
	});

	return servePartialPrerender({
		bypassHeader: BYPASS,
		filePath,
		holes: readPartialHoles(filePath),
		nonce,
		request,
		securityHeaders,
		handle: (inner) => app.handle(inner)
	});
};

describe('React partial prerendering', () => {
	test('the shell resolves static slots and leaves dynamic ones as holes', async () => {
		counts.static = 0;
		counts.dynamic = 0;
		const started = performance.now();
		const { filePath, holesHeader, html } = await captureShell(reactApp());

		expect(performance.now() - started).toBeLessThan(SLOW_HOLE_MS);
		expect(counts).toEqual({ dynamic: 0, static: 1 });
		expect(html).toContain('static resolved');
		expect(html).toContain('greeting loading');
		expect(html).toContain('cart loading');
		expect(html).not.toContain('hello');
		expect(html).toContain('__ABS_SLOT_ENQUEUE__');
		expect(holesHeader.get(PARTIAL_HOLES_HEADER)).toBe(
			'react-greeting,react-cart'
		);
		expect(readPartialHoles(filePath)).toEqual([
			'react-greeting',
			'react-cart'
		]);
	});

	test('a page without dynamic slots is captured whole, with no holes file', async () => {
		const app = new Elysia().use(absoluteRequestContext).get('/', () =>
			handleReactPageRequest({
				collectStreamingSlots: true,
				index: '/react-partial-index.js',
				Page: () => (
					<html lang="en">
						<body>
							<StreamSlot
								id="only-static"
								resolve={() => 'baked'}
							/>
						</body>
					</html>
				)
			})
		);
		const { filePath, holesHeader, html } = await captureShell(app);

		expect(html).toContain('baked');
		expect(holesHeader.get(PARTIAL_HOLES_HEADER)).toBeNull();
		expect(readPartialHoles(filePath)).toEqual([]);
	});

	test('serves the shell at once and streams only the dynamic holes per request', async () => {
		const app = reactApp();
		const { filePath } = await captureShell(app);
		counts.static = 0;
		counts.dynamic = 0;

		const ada = await serve(app, filePath, 'user=ada');
		const adaRead = await readTimed(ada.response);
		const bob = await readTimed(
			(await serve(app, filePath, 'user=bob')).response
		);

		// The first byte doesn't wait for the 600ms hole.
		expect(adaRead.firstByteMs).toBeLessThan(FIRST_BYTE_BUDGET_MS);
		expect(adaRead.totalMs).toBeGreaterThanOrEqual(SLOW_HOLE_MS - 50);
		expect(adaRead.firstChunk).toContain('static navigation');
		expect(adaRead.firstChunk).toContain('static resolved');
		expect(adaRead.firstChunk).not.toContain('hello');
		expect(ada.response.headers.get('cache-control')).toBe(
			'private, no-cache'
		);
		expect(ada.response.headers.get('x-absolute-partial-prerender')).toBe(
			'shell'
		);

		// Each request gets its own holes; static slots never re-resolve.
		expect(adaRead.text).toContain('hello ada');
		expect(adaRead.text).toContain('cart of ada');
		expect(bob.text).toContain('hello bob');
		expect(bob.text).not.toContain('hello ada');
		expect(counts).toEqual({ dynamic: 2, static: 0 });

		// Patches land before the closing tags of a complete document.
		expect(adaRead.text.indexOf('"react-greeting"')).toBeLessThan(
			adaRead.text.indexOf('</body>')
		);
		expect(adaRead.text.trimEnd().endsWith('</html>')).toBe(true);
	});

	test('the shell and the hole patches carry the request nonce', async () => {
		enableCspNonces();
		const app = reactApp();
		const { filePath, html } = await captureShell(app);
		const rendered = html.match(/<script nonce="([^"]+)"/)?.[1];
		const request = new Request('http://localhost/');
		const nonce = getCspNonce(request);
		if (!nonce || !rendered) throw new Error('nonces are off');
		// secureHeaders() would have sent it in the capture's policy header.
		await writeRenderedNonce(filePath, rendered);

		const { response } = await serve(app, filePath, 'user=ada', {
			nonce,
			securityHeaders: {
				'content-security-policy': `script-src 'nonce-${nonce}'`
			}
		});
		const text = await response.text();
		const scriptNonces = [...text.matchAll(/<script nonce="([^"]+)"/g)].map(
			(match) => match[1]
		);

		expect(text).not.toContain(`<script nonce="${rendered}"`);
		expect(text).toContain('hello ada');
		expect(scriptNonces.length).toBeGreaterThan(2);
		expect(scriptNonces.every((value) => value === nonce)).toBe(true);
		expect(response.headers.get('content-security-policy')).toBe(
			`script-src 'nonce-${nonce}'`
		);
	});

	test('hole collection hands over the dynamic slots and no page body', async () => {
		const { response, slots } = await collectPartialHoles(() =>
			runWithAbsoluteRequest(new Request('http://localhost/'), () =>
				reactApp().handle(new Request('http://localhost/'))
			)
		);

		expect(response.status).toBe(204);
		expect(slots?.map((slot) => slot.id)).toEqual([
			'react-greeting',
			'react-cart'
		]);
	});

	test('a plain request still streams every slot, dynamic ones included', async () => {
		const response = await reactApp().handle(
			new Request('http://localhost/', { headers: { cookie: 'user=cy' } })
		);
		const html = await response.text();

		expect(html).toContain('static resolved');
		expect(html).toContain('hello cy');
		expect(response.headers.get(PARTIAL_HOLES_HEADER)).toBeNull();
	});
});

describe('Svelte partial prerendering', () => {
	test('StreamSlot and await-slot holes stream per request into the cached shell', async () => {
		const app = svelteApp();
		const { filePath, html } = await captureShell(app);

		expect(html).toContain('svelte static resolved');
		expect(html).toContain('svelte greeting loading');
		expect(html).toContain('svelte await loading');
		expect(html).not.toContain('svelte hello');
		expect(readPartialHoles(filePath)).toEqual([
			'svelte-greeting',
			'absolute-svelte-await-0'
		]);

		const ada = await readTimed(
			(await serve(app, filePath, 'user=ada')).response
		);

		expect(ada.firstByteMs).toBeLessThan(FIRST_BYTE_BUDGET_MS);
		expect(ada.totalMs).toBeGreaterThanOrEqual(SLOW_HOLE_MS - 50);
		expect(ada.firstChunk).toContain('svelte static resolved');
		expect(ada.text).toContain('svelte hello ada');
		expect(ada.text).toContain('svelte await ada');
		expect(ada.text.trimEnd().endsWith('</html>')).toBe(true);
	});
});
