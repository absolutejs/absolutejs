import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { logWarn } from '../utils/logger';

/* Pre-rendered and ISR-cached pages under secureHeaders().
 *
 * A cached page can't carry a per-request nonce, so the nonce it was
 * rendered with (read from that response's CSP header) is stored next to
 * it as `<page>.nonce`. When the page is served, exactly the attributes
 * with that value are switched to the current request's nonce. Markup
 * injected into the page couldn't have known the render-time nonce, so it
 * stays blocked, as it would on a live render.
 *
 * A page pre-rendered without secureHeaders() has no stored nonce and its
 * scripts have none, so the policy would block them. Such a page is served
 * without a Content-Security-Policy header and a warning names it. */

const CSP_HEADERS = [
	'content-security-policy',
	'content-security-policy-report-only'
];

const noncePath = (htmlPath: string) => htmlPath.replace(/\.html$/, '.nonce');

export const renderedNonce = (response: Response) =>
	CSP_HEADERS.map((name) => response.headers.get(name))
		.map((policy) => policy?.match(/'nonce-([^']+)'/)?.[1])
		.find((nonce) => nonce !== undefined);

export const writeRenderedNonce = async (
	htmlPath: string,
	nonce: string | undefined
) => {
	if (nonce) await Bun.write(noncePath(htmlPath), nonce);
	else await rm(noncePath(htmlPath), { force: true });
};

const readRenderedNonce = (htmlPath: string) => {
	const path = noncePath(htmlPath);

	return existsSync(path) ? readFileSync(path, 'utf-8').trim() : undefined;
};

const restamp = (html: string, previous: string, nonce: string) => {
	const stamp: HTMLRewriterTypes.HTMLRewriterElementContentHandlers = {
		element: (element: HTMLRewriterTypes.Element) => {
			if (element.getAttribute('nonce') === previous)
				element.setAttribute('nonce', nonce);
		}
	};

	// <link rel="modulepreload"> carries the nonce too; the policy checks
	// it like the script it preloads.
	return new HTMLRewriter()
		.on('script', stamp)
		.on('style', stamp)
		.on('link', stamp)
		.transform(new Response(html))
		.text();
};

const warned = new Set<string>();

const warnOnce = (htmlPath: string) => {
	if (warned.has(htmlPath)) return;
	warned.add(htmlPath);
	logWarn(
		`${htmlPath} was pre-rendered without secureHeaders(), so its scripts carry no nonce; it is served without a Content-Security-Policy. Rebuild with secureHeaders() in use to cover it.`
	);
};

/** The response for a cached page, given this request's nonce and security
 *  headers. Returns the headers to drop when the page can't be served
 *  under the policy. */
export const servePrerenderedPage = async (
	htmlPath: string,
	nonce: string,
	securityHeaders: Record<string, string>
) => {
	const rendered = readRenderedNonce(htmlPath);
	if (!rendered) {
		warnOnce(htmlPath);
		const headers = Object.fromEntries(
			Object.entries(securityHeaders).filter(
				([name]) => !CSP_HEADERS.includes(name)
			)
		);

		return {
			dropHeaders: CSP_HEADERS,
			response: new Response(Bun.file(htmlPath), {
				headers: {
					...headers,
					'content-type': 'text/html; charset=utf-8'
				}
			})
		};
	}

	const html = await restamp(
		await Bun.file(htmlPath).text(),
		rendered,
		nonce
	);

	return {
		dropHeaders: [],
		response: new Response(html, {
			headers: {
				...securityHeaders,
				'content-type': 'text/html; charset=utf-8'
			}
		})
	};
};
