import { describe, expect, test } from 'bun:test';
import { composeLlmsFull } from '../../../src/core/llmsFull';
import type { LlmsFullManifest } from '../../../src/utils/llmsFullManifest';
import { MARKDOWN_SOURCE_HEADER } from '../../../src/utils/pageMarkdownRef';

/* `llms-full.txt`, composed from an app's pages. The app here is a
 * function from a request to a response. */

const html = (body: string) =>
	new Response(`<html><body><main>${body}</main></body></html>`, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

const PAGES: Record<string, () => Response> = {
	'/': () => html('<h1>Home</h1><p>Welcome.</p>'),
	'/account': () =>
		new Response(null, { headers: { location: '/login' }, status: 302 }),
	'/api': () => Response.json({ not: 'a page' }),
	'/broken': () => {
		throw new Error('render failed');
	},
	'/empty': () => html('<h1>Nothing here</h1>'),
	'/own': () =>
		new Response('# Own\n\nWritten by the route.\n', {
			headers: { 'content-type': 'text/markdown; charset=utf-8' }
		}),
	'/pricing': () => html('<h1>Pricing</h1><p>Forty.</p>')
};

const seen: Request[] = [];
const handle = async (request: Request) => {
	seen.push(request);
	const answer = PAGES[new URL(request.url).pathname];

	return answer ? answer() : new Response('nope', { status: 404 });
};

const manifestOf = (paths: string[], extra: Partial<LlmsFullManifest> = {}) => {
	const manifest: LlmsFullManifest = {
		maxPages: 500,
		pages: paths.map((path) => ({
			path,
			url: `https://acme.test${path}`
		})),
		revalidate: 3600,
		title: 'Acme',
		...extra
	};

	return manifest;
};

const compose = (paths: string[], extra?: Partial<LlmsFullManifest>) =>
	composeLlmsFull(manifestOf(paths, extra), handle, 'http://localhost:3000');

describe('llms-full.txt', () => {
	test('is the site’s name, then each page under where it is', async () => {
		expect(
			await compose(['/', '/pricing'], { summary: 'Anvils,\nto order.' })
		).toBe(
			[
				'# Acme\n\n> Anvils, to order.',
				'# Home\n\nSource: https://acme.test/\n\nWelcome.',
				'# Pricing\n\nSource: https://acme.test/pricing\n\nForty.\n'
			].join('\n\n---\n\n')
		);
	});

	test('takes a route’s own Markdown as it is', async () => {
		expect(await compose(['/own'])).toContain(
			'# Own\n\nSource: https://acme.test/own\n\nWritten by the route.'
		);
	});

	test('leaves out what is not a page for an anonymous visitor', async () => {
		const text = await compose([
			'/account',
			'/api',
			'/broken',
			'/empty',
			'/missing',
			'/pricing'
		]);

		expect(text).toBe(
			'# Acme\n\n---\n\n# Pricing\n\nSource: https://acme.test/pricing\n\nForty.\n'
		);
	});

	test('holds no more pages than asked', async () => {
		const text = await compose(['/', '/pricing'], { maxPages: 1 });

		expect(text).toContain('# Home');
		expect(text).not.toContain('# Pricing');
	});

	test('asks for each page as itself, with no cookie, marked as its own', async () => {
		seen.length = 0;
		await compose(['/pricing']);
		const [request] = seen;

		expect(request?.url).toBe('http://localhost:3000/pricing');
		expect(request?.headers.get('cookie')).toBeNull();
		expect(request?.headers.get('authorization')).toBeNull();
		expect(request?.headers.has(MARKDOWN_SOURCE_HEADER)).toBe(true);
	});
});
