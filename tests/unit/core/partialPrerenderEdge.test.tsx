import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import {
	PARTIAL_SHELL_HEADER,
	readPartialHoles,
	writePartialHoles
} from '../../../src/core/partialPrerender';
import {
	edgeResponseFor,
	HOLES_QUERY
} from '../../../src/core/partialPrerenderEdge';
import type { ServePartialPrerenderInput } from '../../../src/core/partialPrerenderServe';
import {
	renderedNonce,
	writeRenderedNonce
} from '../../../src/core/prerenderNonce';
import { absoluteRequestContext } from '../../../src/core/requestContext';
import { defineHoles } from '../../../src/core/routeHoles';
import { StreamSlot } from '../../../src/react/components';
import { handleReactPageRequest } from '../../../src/react';
import { streamSlotPayloadLines } from '../../../src/utils/streamingSlots';

/* Partial prerendering in edge mode: the shell served alone, for a
 * shared cache to keep, and the holes in a request of their own. */

const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		directories.map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

const userFrom = (request: Request) =>
	request.headers.get('cookie')?.match(/user=(\w+)/)?.[1] ?? 'guest';

type Seen = { handler: number; urls: string[] };

const appFor = (path: string, seen: Seen) => {
	const Page = ({ user }: { user: string }) => (
		<html lang="en">
			<head>
				<title>Edge</title>
			</head>
			<body>
				<nav>static navigation</nav>
				<StreamSlot
					dynamic
					fallbackHtml="<p>greeting loading</p>"
					id="greeting"
					resolve={() => `<section>page says hello ${user}</section>`}
				/>
			</body>
		</html>
	);

	return new Elysia().use(absoluteRequestContext).get(path, ({ request }) => {
		seen.handler += 1;
		seen.urls.push(new URL(request.url).search);

		return handleReactPageRequest({
			collectStreamingSlots: true,
			index: '/edge-index.js',
			Page,
			props: { user: userFrom(request) }
		});
	});
};

type App = ReturnType<typeof appFor>;

const captureShell = async (app: App, path: string) => {
	const response = await app.handle(
		new Request(`http://localhost${path}`, {
			headers: { [PARTIAL_SHELL_HEADER]: '1' }
		})
	);
	const dir = await mkdtemp(join(tmpdir(), 'absolute-edge-'));
	directories.push(dir);
	const filePath = join(dir, 'index.html');
	await Bun.write(filePath, await response.text());
	await writeRenderedNonce(filePath, renderedNonce(response));
	await writePartialHoles(filePath, response);

	return filePath;
};

const inputFor = (
	app: App,
	filePath: string,
	request: Request,
	extra: Partial<ServePartialPrerenderInput> = {}
) => {
	const input: ServePartialPrerenderInput = {
		bypassHeader: 'X-Absolute-Prerender-Bypass',
		filePath,
		holes: readPartialHoles(filePath),
		request,
		...extra,
		handle: (inner) => app.handle(inner)
	};

	return input;
};

const answer = async (response: ReturnType<typeof edgeResponseFor>) => {
	const resolved = await response;
	if (!resolved) throw new Error('expected an edge response');

	return resolved;
};

const parseLine = (line: string) => {
	const parsed: unknown = JSON.parse(line);

	return parsed;
};

const linesOf = async (response: Response) =>
	(await response.text()).split('\n').filter(Boolean).map(parseLine);

describe('edge mode', () => {
	test('is off unless asked for', async () => {
		const seen: Seen = { handler: 0, urls: [] };
		const app = appFor('/edge/off', seen);
		const filePath = await captureShell(app, '/edge/off');
		const input = inputFor(
			app,
			filePath,
			new Request('http://localhost/edge/off')
		);

		expect(edgeResponseFor(input, undefined)).toBeUndefined();
		expect(edgeResponseFor(input, false)).toBeUndefined();
	});

	/* A stored page cannot carry this request's nonce, and its inline
	 * scripts would need one. */
	test('is not served to an app that sends per-request CSP nonces', async () => {
		const seen: Seen = { handler: 0, urls: [] };
		const app = appFor('/edge/nonces', seen);
		const filePath = await captureShell(app, '/edge/nonces');
		const input = inputFor(
			app,
			filePath,
			new Request('http://localhost/edge/nonces'),
			{
				nonce: 'abc',
				securityHeaders: {
					'content-security-policy': "default-src 'self'"
				}
			}
		);
		const logged: string[] = [];
		const original = console.log;
		console.log = (...parts: unknown[]) => {
			logged.push(parts.map(String).join(' '));
		};
		try {
			expect(edgeResponseFor(input, true)).toBeUndefined();
			expect(edgeResponseFor(input, true)).toBeUndefined();
		} finally {
			console.log = original;
		}

		expect(
			logged.filter((line) => line.includes('static.partial.edge'))
		).toHaveLength(1);
	});
});

describe('the shell, in edge mode', () => {
	const shellFor = async (path: string, edge: true | { maxAge: number }) => {
		const seen: Seen = { handler: 0, urls: [] };
		const app = appFor(path, seen);
		const filePath = await captureShell(app, path);
		const ask = (headers: Record<string, string> = {}) =>
			answer(
				edgeResponseFor(
					inputFor(
						app,
						filePath,
						new Request(`http://localhost${path}`, { headers })
					),
					edge
				)
			);

		return { ask, filePath, seen };
	};

	test('is the page without its holes, the same for every visitor', async () => {
		const { ask, seen } = await shellFor('/edge/shell', true);

		const ada = await ask({ cookie: 'user=ada' });
		const grace = await ask({ cookie: 'user=grace' });
		const html = await ada.text();

		expect(html).toContain('static navigation');
		expect(html).toContain('greeting loading');
		expect(html).not.toContain('hello');
		expect(await grace.text()).toBe(html);
		// Nothing was rendered to send it.
		expect(seen.handler).toBe(1);
	});

	test('carries the loader that asks for the holes, inside the body', async () => {
		const { ask } = await shellFor('/edge/loader', true);

		const html = await (await ask()).text();
		const loader = html.indexOf(HOLES_QUERY);

		expect(loader).toBeGreaterThan(0);
		expect(loader).toBeLessThan(html.search(/<\/body>/i));
	});

	test('may be kept by any cache, and is checked before each use', async () => {
		const { ask } = await shellFor('/edge/policy', true);

		const response = await ask();

		expect(response.headers.get('cache-control')).toBe('public, no-cache');
		expect(response.headers.get('etag')).toMatch(/^"[^"]+"$/);
		// The address also answers requests for the page's data.
		expect(response.headers.get('vary')).toBe('Accept');
	});

	test('with a lifetime, a shared cache answers on its own for that long', async () => {
		const { ask } = await shellFor('/edge/lifetime', { maxAge: 300 });

		expect((await ask()).headers.get('cache-control')).toBe(
			'public, max-age=0, s-maxage=300, must-revalidate'
		);
	});

	test('answers a current copy with 304 and no body', async () => {
		const { ask } = await shellFor('/edge/current', true);
		const etag = (await ask()).headers.get('etag') ?? '';

		const again = await ask({ 'if-none-match': etag });
		// What a cache that compressed the page sends back.
		const weakened = await ask({ 'if-none-match': `W/${etag}` });
		const stale = await ask({ 'if-none-match': '"something-else"' });

		expect(again.status).toBe(304);
		expect(await again.text()).toBe('');
		expect(again.headers.get('etag')).toBe(etag);
		expect(weakened.status).toBe(304);
		expect(stale.status).toBe(200);
	});

	test('has a new tag once the page has been rendered again', async () => {
		const { ask, filePath } = await shellFor('/edge/revalidated', true);
		const before = (await ask()).headers.get('etag');
		const html = await Bun.file(filePath).text();

		await Bun.write(
			filePath,
			html.replace('static navigation', 'new navigation, longer')
		);
		const after = await ask({ 'if-none-match': before ?? '' });

		expect(after.status).toBe(200);
		expect(after.headers.get('etag')).not.toBe(before);
		expect(await after.text()).toContain('new navigation, longer');
	});
});

describe('the holes, in edge mode', () => {
	const holesUrl = (path: string, query = '') =>
		`http://localhost${path}?${query}${query ? '&' : ''}${HOLES_QUERY}=1`;

	test('are each a line of JSON, for the visitor who asked, and never cached', async () => {
		const seen: Seen = { handler: 0, urls: [] };
		const path = '/edge/holes';
		const app = appFor(path, seen);
		const filePath = await captureShell(app, path);
		const ask = (user: string) =>
			answer(
				edgeResponseFor(
					inputFor(
						app,
						filePath,
						new Request(holesUrl(path), {
							headers: { cookie: `user=${user}` }
						})
					),
					true
				)
			);

		const ada = await ask('ada');

		expect(ada.headers.get('cache-control')).toBe('private, no-store');
		expect(ada.headers.get('content-type')).toContain(
			'application/x-ndjson'
		);
		expect(await linesOf(ada)).toEqual([
			{
				id: 'greeting',
				payload: '<section>page says hello ada</section>'
			}
		]);
		expect(await linesOf(await ask('grace'))).toEqual([
			{
				id: 'greeting',
				payload: '<section>page says hello grace</section>'
			}
		]);
	});

	/* The marker is the loader's, not the page's: a page that reads its
	 * query must see the one the visitor asked with. */
	test('are resolved for the address without the loader’s marker', async () => {
		const seen: Seen = { handler: 0, urls: [] };
		const path = '/edge/marker';
		const app = appFor(path, seen);
		const filePath = await captureShell(app, path);
		seen.urls.length = 0;

		await (
			await answer(
				edgeResponseFor(
					inputFor(
						app,
						filePath,
						new Request(holesUrl(path, 'tab=2'))
					),
					true
				)
			)
		).text();

		expect(seen.urls).toEqual(['?tab=2']);
	});

	test('come from the route’s own holes without running the route', async () => {
		const seen: Seen = { handler: 0, urls: [] };
		const path = '/edge/declared';
		const app = appFor(path, seen);
		const urls: string[] = [];
		defineHoles(path, {
			greeting: ({ request }) => {
				urls.push(new URL(request.url).search);

				return `<section>route says hello ${userFrom(request)}</section>`;
			}
		});
		const filePath = await captureShell(app, path);

		const response = await answer(
			edgeResponseFor(
				inputFor(
					app,
					filePath,
					new Request(holesUrl(path, 'tab=2'), {
						headers: { cookie: 'user=ada' }
					})
				),
				true
			)
		);

		expect(await linesOf(response)).toEqual([
			{
				id: 'greeting',
				payload: '<section>route says hello ada</section>'
			}
		]);
		expect(urls).toEqual(['?tab=2']);
		// Only the capture ran it.
		expect(seen.handler).toBe(1);
	});
});

describe('slots as lines of JSON', () => {
	const read = async (stream: ReadableStream<Uint8Array>) =>
		linesOf(new Response(stream));

	test('arrive in the order they resolve, not the order they were given', async () => {
		const lines = await read(
			streamSlotPayloadLines([
				{
					id: 'slow',
					resolve: async () => {
						await Bun.sleep(40);

						return 'slow';
					}
				},
				{ id: 'fast', resolve: () => 'fast' }
			])
		);

		expect(lines).toEqual([
			{ id: 'fast', payload: 'fast' },
			{ id: 'slow', payload: 'slow' }
		]);
	});

	test('a slot that fails sends its error markup, or nothing', async () => {
		const failing = () => {
			throw new Error('unreachable');
		};

		const lines = await read(
			streamSlotPayloadLines(
				[
					{
						errorHtml: '<p>unavailable</p>',
						id: 'told',
						resolve: failing
					},
					{ id: 'silent', resolve: failing },
					{ id: 'fine', resolve: () => 'fine' }
				],
				{ onError: () => undefined }
			)
		);

		expect(lines).toContainEqual({
			id: 'told',
			payload: '<p>unavailable</p>'
		});
		expect(lines).toContainEqual({ id: 'fine', payload: 'fine' });
		expect(lines).toHaveLength(2);
	});

	test('no slots is an empty stream that ends', async () => {
		expect(await read(streamSlotPayloadLines([]))).toEqual([]);
	});
});
