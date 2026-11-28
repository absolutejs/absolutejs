import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import {
	LLMS_FULL_MANIFEST,
	type LlmsFullManifest
} from '../utils/llmsFullManifest';
import { logWarn } from '../utils/logger';
import { compressedText } from './compressText';
import { type AppHandle, readPageMarkdown } from './pageMarkdown';

/* `llms-full.txt`: every page's text, in one Markdown file.
 *
 * A build cannot write it. A page's text exists once something renders
 * the page, and most pages are rendered by the running server, from
 * data the build does not have. So the build writes the list of pages
 * (`llms: { full: true }`, core/build.ts) and the server makes the file
 * the first time it is asked for: it asks itself for each page as
 * Markdown, one at a time, and joins what comes back.
 *
 * That is every page's render at once, so the file is made once and
 * kept. Requests that arrive while it is being made wait for that one
 * making rather than starting another, and the kept copy is served
 * until it is `revalidate` seconds old, when the next request is served
 * the old copy and a new one is made behind it.
 *
 * The pages are asked for with no cookie and no authorization: the file
 * is one copy for everyone, so it holds what anyone may read. A page
 * that redirects or refuses a visitor who is not signed in is left
 * out. */

export const LLMS_FULL_PATH = '/llms-full.txt';

const MS_PER_SECOND = 1000;

const isManifest = (value: unknown): value is LlmsFullManifest =>
	typeof value === 'object' &&
	value !== null &&
	'pages' in value &&
	Array.isArray(value.pages) &&
	'title' in value &&
	typeof value.title === 'string';

const readManifest = (buildDir: string) => {
	const path = join(buildDir, LLMS_FULL_MANIFEST);
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

		return isManifest(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
};

/* Where the page is, under its first heading: a reader that quotes the
 * text can say where it came from. */
const withSource = (markdown: string, url: string) => {
	const source = `Source: ${url}`;
	const text = markdown.trim();
	const [heading = '', ...rest] = text.split('\n');

	return heading.startsWith('# ')
		? `${heading}\n\n${source}\n\n${rest.join('\n').trim()}`.trim()
		: `${source}\n\n${text}`;
};

const anonymous = (origin: string, path: string) =>
	new Request(new URL(path, origin), { method: 'GET' });

/* A page with a heading and nothing under it says nothing: one not
 * rendered on the server, or one that fills in after it loads. */
const hasBody = (markdown: string) =>
	markdown
		.trim()
		.split('\n')
		.some((line, index) => index > 0 && line.trim() !== '');

const readPage = async (
	handle: AppHandle,
	origin: string,
	page: LlmsFullManifest['pages'][number]
) => {
	const request = anonymous(origin, page.path);
	const read = await readPageMarkdown(handle, request, new URL(request.url));
	if (!read.response)
		return hasBody(read.markdown)
			? [withSource(read.markdown, page.url)]
			: [];
	await read.response.body?.cancel();

	return [];
};

const pageText = (
	handle: AppHandle,
	origin: string,
	page: LlmsFullManifest['pages'][number]
) =>
	readPage(handle, origin, page).catch((error: unknown) => {
		logWarn(
			`llms-full.txt: ${page.path} could not be read and is left out: ${error instanceof Error ? error.message : String(error)}`
		);
		const none: string[] = [];

		return none;
	});

/** The file's text: a heading, the summary, and each page in turn. */
export const composeLlmsFull = async (
	manifest: LlmsFullManifest,
	handle: AppHandle,
	origin: string
) => {
	const pages = manifest.pages.slice(0, manifest.maxPages);
	// One page at a time: this is every page's render, and running them
	// together would be the whole site's load at once.
	const texts = await pages.reduce(
		async (previous, page) => [
			...(await previous),
			...(await pageText(handle, origin, page))
		],
		Promise.resolve<string[]>([])
	);
	const summary = manifest.summary?.replace(/\s+/g, ' ').trim();
	const head = `# ${manifest.title}${summary ? `\n\n> ${summary}` : ''}`;

	return `${[head, ...texts].join('\n\n---\n\n')}\n`;
};

type Kept = { at: number; text: string };

/** Serves `/llms-full.txt` when the build left a list of pages for it. */
export const llmsFull = (buildDir: string) => {
	const manifest = readManifest(buildDir);
	// A file of that name in the build directory is the app's own.
	if (!manifest || existsSync(join(buildDir, 'llms-full.txt')))
		return new Elysia({ name: 'absolutejs-llms-full-off' });
	if (manifest.pages.length > manifest.maxPages)
		logWarn(
			`llms-full.txt holds the first ${manifest.maxPages} of ${manifest.pages.length} pages. Raise llms.full.maxPages, or leave pages out with llms.exclude.`
		);
	let handle: AppHandle | undefined;
	let kept: Kept | undefined;
	let making: Promise<Kept> | undefined;
	const make = (appHandle: AppHandle, origin: string) => {
		making ??= composeLlmsFull(manifest, appHandle, origin)
			.then((text) => {
				kept = { at: Date.now(), text };

				return kept;
			})
			.finally(() => {
				making = undefined;
			});

		return making;
	};
	const current = async (appHandle: AppHandle, origin: string) => {
		if (!kept) return make(appHandle, origin);
		const isStale =
			Date.now() - kept.at > manifest.revalidate * MS_PER_SECOND;
		// Served the copy there is, and a new one made behind it.
		if (isStale) void make(appHandle, origin).catch(() => undefined);

		return kept;
	};
	const plugin = new Elysia({ name: 'absolutejs-llms-full' }).onRequest(
		({ request }) => {
			if (request.method !== 'GET' || !handle) return undefined;
			const url = new URL(request.url);
			if (url.pathname !== LLMS_FULL_PATH) return undefined;

			// Compressed for the client that asked (compressText.ts).
			return current(handle, url.origin).then(({ text }) =>
				compressedText(text, request, {
					'content-type': 'text/plain; charset=utf-8'
				})
			);
		}
	);
	plugin.onStart((app) => {
		handle = (request) => app.handle(request);
	});

	return plugin;
};
