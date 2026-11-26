import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import {
	CACHE_TAGS_HEADER,
	cacheTag,
	cacheTagEmitter,
	decodeCacheTags,
	encodeCacheTags,
	readCacheTags,
	routesTagged,
	writeCacheTags
} from '../../../src/core/cacheTags';
import {
	PRERENDER_BYPASS_HEADER,
	PRERENDER_BYPASS_TOKEN
} from '../../../src/core/prerender';
import { absoluteRequestContext } from '../../../src/core/requestContext';

/* Cache tags end to end inside one process: a render declares them,
 * the response carries them to whoever is pre-rendering — and to nobody
 * else — and they are kept beside the page, where `revalidateTag` finds
 * the routes that carry one. */

const SHELL_HEADER = 'X-Absolute-Partial-Shell';

const streamed = (late: () => void) =>
	new Response(
		new ReadableStream({
			start: async (controller) => {
				await Bun.sleep(5);
				// The part of a page that renders after its headers
				// would normally have gone.
				late();
				controller.enqueue(new TextEncoder().encode('<p>page</p>'));
				controller.close();
			}
		}),
		{ headers: { 'content-type': 'text/html' } }
	);

const app = new Elysia()
	.use(absoluteRequestContext)
	.use(cacheTagEmitter())
	.get('/page', () => {
		cacheTag('posts', 'post:hello');

		return streamed(() => cacheTag('authors'));
	})
	.get('/value', () => {
		cacheTag('settings');

		return { ok: true };
	})
	.get('/untagged', () => new Response('<p>plain</p>'));

const ask = (path: string, headers: Record<string, string> = {}) =>
	app.handle(new Request(`http://localhost${path}`, { headers }));

const asPrerenderer: Record<string, string> = {
	[PRERENDER_BYPASS_HEADER]: PRERENDER_BYPASS_TOKEN,
	[SHELL_HEADER]: '1'
};

describe('cacheTag()', () => {
	test('does nothing outside a request, so a loader can call it anywhere', () => {
		expect(() => cacheTag('posts')).not.toThrow();
	});

	test('refuses a tag that could not be stored one to a line', () => {
		expect(() => cacheTag('')).toThrow('non-empty strings');
		expect(() => cacheTag('two\nlines')).toThrow('line breaks');
	});
});

describe('the tags a render declared', () => {
	test('reach the pre-renderer, including one declared after the page began to stream', async () => {
		const response = await ask('/page', asPrerenderer);

		expect(
			decodeCacheTags(response.headers.get(CACHE_TAGS_HEADER))
		).toEqual(['posts', 'post:hello', 'authors']);
		// And the page itself is whole.
		expect(await response.text()).toBe('<p>page</p>');
	});

	test('reach it on a response that is a plain value, too', async () => {
		const response = await ask('/value', asPrerenderer);

		expect(response.headers.get(CACHE_TAGS_HEADER)).toBe('settings');
	});

	/* A tag can name a customer or a draft. It is the pre-renderer's
	 * business and nobody else's. */
	test('are not sent to a visitor', async () => {
		const response = await ask('/page');

		expect(response.headers.has(CACHE_TAGS_HEADER)).toBe(false);
		expect(await response.text()).toBe('<p>page</p>');
	});

	test('are not sent for the shell header alone, which anyone can send', async () => {
		const response = await ask('/page', { [SHELL_HEADER]: '1' });

		expect(response.headers.has(CACHE_TAGS_HEADER)).toBe(false);
	});

	test('are not sent to a forged token', async () => {
		const response = await ask('/page', {
			[PRERENDER_BYPASS_HEADER]: 'guessed',
			[SHELL_HEADER]: '1'
		});

		expect(response.headers.has(CACHE_TAGS_HEADER)).toBe(false);
	});

	/* The per-request render of a partial shell's dynamic holes carries
	 * the token too. It streams to a visitor, so it must not be read to
	 * the end for its tags — told apart by having no shell header. */
	test('are not collected for a hole render, which must keep streaming', async () => {
		const response = await ask('/page', {
			[PRERENDER_BYPASS_HEADER]: PRERENDER_BYPASS_TOKEN
		});

		expect(response.headers.has(CACHE_TAGS_HEADER)).toBe(false);
	});

	test('a page that declared none has no header', async () => {
		const response = await ask('/untagged', asPrerenderer);

		expect(response.headers.has(CACHE_TAGS_HEADER)).toBe(false);
		expect(await response.text()).toBe('<p>plain</p>');
	});

	test('survive the header whatever characters they hold', () => {
		const tags = ['a,b', 'user:42', 'with space', 'ünïcödé', '100%'];

		expect(decodeCacheTags(encodeCacheTags(tags))).toEqual(tags);
		expect(decodeCacheTags(null)).toEqual([]);
	});
});

describe('tags kept beside a pre-rendered page', () => {
	let dir = '';
	const live = (name: string) => join(dir, name);
	const rendered = (tags: string[]) =>
		new Response('', {
			headers:
				tags.length > 0
					? { [CACHE_TAGS_HEADER]: encodeCacheTags(tags) }
					: {}
		});
	const page = async (name: string, tags: string[]) => {
		await mkdir(join(dir, name, '..'), { recursive: true });
		await writeFile(live(`${name}.html`), '<p>page</p>');
		await writeCacheTags(live(`${name}.html`), rendered(tags));
	};

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'absolute-cache-tags-'));
		await page('index', ['posts']);
		await page('about', ['settings']);
		await page('blog/hello', ['posts', 'post:hello', 'a,b']);
		await page('blog/world', ['posts', 'post:world']);
		await page('plain', []);
	});

	afterAll(() => rm(dir, { force: true, recursive: true }));

	test('are written one to a line, and read back', async () => {
		expect(await readFile(live('blog/hello.tags'), 'utf-8')).toBe(
			'posts\npost:hello\na,b\n'
		);
		expect(readCacheTags(live('blog/hello.html'))).toEqual([
			'posts',
			'post:hello',
			'a,b'
		]);
	});

	test('a page with no tags has no file, and reads as none', () => {
		expect(existsSync(live('plain.tags'))).toBe(false);
		expect(readCacheTags(live('plain.html'))).toEqual([]);
	});

	/* A page re-rendered without a tag it used to declare must stop
	 * being revalidated for it. */
	test('a re-render that declares none removes the file', async () => {
		await page('once', ['posts']);
		await writeCacheTags(live('once.html'), rendered([]));

		expect(existsSync(live('once.tags'))).toBe(false);
		await rm(live('once.html'));
	});

	test('routesTagged finds every route carrying a tag, nested and the root', () => {
		expect(routesTagged(dir, ['posts'])).toEqual([
			'/',
			'/blog/hello',
			'/blog/world'
		]);
		expect(routesTagged(dir, ['post:world'])).toEqual(['/blog/world']);
		expect(routesTagged(dir, ['a,b'])).toEqual(['/blog/hello']);
	});

	test('several tags select the routes carrying any of them, each once', () => {
		expect(routesTagged(dir, ['settings', 'post:hello', 'posts'])).toEqual([
			'/',
			'/about',
			'/blog/hello',
			'/blog/world'
		]);
	});

	test('a tag no page carries selects nothing', () => {
		expect(routesTagged(dir, ['nothing'])).toEqual([]);
		expect(routesTagged(dir, [])).toEqual([]);
		expect(routesTagged(join(dir, 'missing'), ['posts'])).toEqual([]);
	});

	/* Read from the directory each time: what another worker wrote or
	 * removed since the last call is what this call sees. */
	test('sees a page another worker tagged, and forgets one it took down', async () => {
		await page('blog/late', ['posts']);
		expect(routesTagged(dir, ['posts'])).toContain('/blog/late');

		// The page goes; a tags file left behind must not bring the
		// route back.
		await rm(live('blog/late.html'));
		expect(routesTagged(dir, ['posts'])).not.toContain('/blog/late');
		await rm(live('blog/late.tags'));
	});
});
