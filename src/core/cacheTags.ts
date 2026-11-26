import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { isPrerendering } from '../utils/isPrerendering';
import { filenameToRoute } from './prerenderPaths';
import { getAbsoluteRequestStore } from './requestContext';

/* Cache tags: a page says what data it shows, and a change says what
 * data it touched.
 *
 * `revalidatePath` needs the code making a change to know every URL the
 * change shows up on. Editing a post touches its own page, the blog
 * index, the home page's "latest" list and a tag page, and the handler
 * has to name them all; the one it forgets stays stale with nothing to
 * say so. A tag turns the dependency round. The code that READS posts
 * calls `cacheTag('posts')`, so every page that shows them is marked
 * without knowing it, and the code that changes a post calls
 * `revalidateTag('posts')`.
 *
 * The tags a render declared travel to the pre-renderer in a response
 * header and are kept in a file beside the page, like its nonce and its
 * dynamic holes. On disk rather than in memory, because the workers of
 * a clustered server share that directory and nothing else. */

export const CACHE_TAGS_HEADER = 'X-Absolute-Cache-Tags';

const TAGS_EXTENSION = '.tags';
const LINE_BREAK = /[\r\n]/;
const BYPASS_TOKEN_KEY = Symbol.for('absolutejs.prerenderBypassToken');
const BYPASS_HEADER = 'X-Absolute-Prerender-Bypass';
const SHELL_HEADER = 'X-Absolute-Partial-Shell';

const assertTag = (tag: unknown) => {
	if (typeof tag === 'string' && tag !== '' && !LINE_BREAK.test(tag)) return;
	throw new TypeError(
		`cacheTag() takes non-empty strings without line breaks; it was given ${JSON.stringify(tag)}.`
	);
};

const safeDecode = (value: string) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const tagsPath = (htmlPath: string) =>
	htmlPath.replace(/\.html$/, TAGS_EXTENSION);

const readTagsFile = (path: string) => {
	try {
		return readFileSync(path, 'utf-8')
			.split('\n')
			.filter((line) => line !== '');
	} catch {
		return [];
	}
};

const tagFilesIn = (directory: string, prefix = ''): string[] => {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries.flatMap((entry) => {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory())
			return tagFilesIn(join(directory, entry.name), relativePath);

		return entry.name.endsWith(TAGS_EXTENSION) ? [relativePath] : [];
	});
};

/** Mark the page being rendered as showing this data, so
 *  `revalidateTag` with the same tag re-renders it.
 *
 *      export const posts = defineLoader(async () => {
 *          cacheTag('posts');
 *          return db.posts.all();
 *      });
 *
 *  Call it beside the read, from a loader, a route's `load`, a handler
 *  or anything they call. It matters only for a page that is
 *  pre-rendered; anywhere else, and outside a request, it does nothing,
 *  so a loader can declare its tags unconditionally. */
export const cacheTag = (...tags: string[]) => {
	tags.forEach(assertTag);
	const store = getAbsoluteRequestStore();
	if (!store) return;
	const declared = store.cacheTags ?? new Set<string>();
	tags.forEach((tag) => declared.add(tag));
	store.cacheTags = declared;
};

/* The tags a render declared, put on its response for the pre-renderer.
 *
 * A page that streams sends its headers before it has finished
 * rendering, and a `cacheTag()` called from the part still to come would
 * arrive too late to be in them. So the response to a pre-render is
 * read to the end first. That costs nothing a visitor sees: this runs
 * only for the pre-renderer's own request, which reads the whole
 * document before doing anything with it anyway. */
export const cacheTagEmitter = () =>
	new Elysia({ name: 'absolutejs-cache-tags' })
		.mapResponse(async ({ request, responseValue, set }) => {
			if (!wantsCacheTags(request)) return undefined;
			const store = getAbsoluteRequestStore();
			if (!store || store.request !== request) return undefined;
			if (!(responseValue instanceof Response)) {
				const declared = encodeCacheTags(store.cacheTags ?? []);
				if (declared !== '') set.headers[CACHE_TAGS_HEADER] = declared;

				return undefined;
			}
			const body = await responseValue.arrayBuffer();
			const headers = new Headers(responseValue.headers);
			const declared = encodeCacheTags(store.cacheTags ?? []);
			if (declared !== '') headers.set(CACHE_TAGS_HEADER, declared);

			return new Response(body, {
				headers,
				status: responseValue.status,
				statusText: responseValue.statusText
			});
		})
		.as('global');

export const decodeCacheTags = (header: string | null) =>
	(header ?? '')
		.split(',')
		.filter((part) => part !== '')
		.map(safeDecode);

export const encodeCacheTags = (tags: Iterable<string>) =>
	[...tags].map(encodeURIComponent).join(',');

/** The tags the pre-rendered page at `htmlPath` was rendered with. */
export const readCacheTags = (htmlPath: string) =>
	readTagsFile(tagsPath(htmlPath));

/** The pre-rendered routes carrying any of `tags`, read from the
 *  directory each time it is asked.
 *
 *  Not an index kept in memory: a page another worker rendered, created
 *  or took down changes these files without this process hearing of it,
 *  and an index that was right when it was built would revalidate the
 *  wrong pages. The directory is small and already in the page cache. */
export const routesTagged = (prerenderDir: string, tags: readonly string[]) => {
	const wanted = new Set(tags);

	return tagFilesIn(prerenderDir)
		.filter((relativePath) =>
			readTagsFile(join(prerenderDir, relativePath)).some((tag) =>
				wanted.has(tag)
			)
		)
		.map((relativePath) =>
			filenameToRoute(
				relativePath.replace(
					new RegExp(`\\${TAGS_EXTENSION}$`),
					'.html'
				)
			)
		)
		.filter((route) =>
			existsSync(
				join(
					prerenderDir,
					route === '/' ? 'index.html' : `${route.slice(1)}.html`
				)
			)
		)
		.sort();
};

/* Tags go to whoever is pre-rendering a page and to nobody else. That
 * is a request for the static shell, made either to the build's
 * pre-render server or with this process's bypass token — how the
 * running server re-renders its own pages. A visitor has no use for
 * them, and a tag such as `customer:acme` is not theirs to read.
 *
 * The shell header is what tells a page render from the other internal
 * request that carries the token: the per-request render of a partial
 * shell's dynamic holes, which streams to a visitor and must not be held
 * back for its tags. */
export const wantsCacheTags = (request: Request) => {
	if (request.headers.get(SHELL_HEADER) === null) return false;
	if (isPrerendering()) return true;
	const token: unknown = Reflect.get(globalThis, BYPASS_TOKEN_KEY);

	return (
		typeof token === 'string' &&
		request.headers.get(BYPASS_HEADER) === token
	);
};

/** Writes the tags a render declared beside its page, one to a line,
 *  or removes the file when it declared none. */
export const writeCacheTags = async (htmlPath: string, response: Response) => {
	const tags = decodeCacheTags(response.headers.get(CACHE_TAGS_HEADER));
	if (tags.length > 0)
		await Bun.write(tagsPath(htmlPath), `${tags.join('\n')}\n`);
	else await rm(tagsPath(htmlPath), { force: true });

	return tags;
};
