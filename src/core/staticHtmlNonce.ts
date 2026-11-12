import { readCspNonce } from '../utils/cspNonceRef';

/* HTML and HTMX pages, and html convention files, are files from the
 * project rather than markup rendered from data, so every inline <script>
 * and <style> in them is the author's own: each gets the request's CSP
 * nonce. Framework pages never go through this; their scripts get the
 * nonce where AbsoluteJS writes them, so a script injected through
 * {@html} / v-html / dangerouslySetInnerHTML stays blocked. */
export const nonceStaticHtml = async (
	html: string,
	nonce: string | undefined = readCspNonce()
) => {
	if (!nonce) return html;
	const stamp: HTMLRewriterTypes.HTMLRewriterElementContentHandlers = {
		element: (element: HTMLRewriterTypes.Element) => {
			if (!element.hasAttribute('nonce'))
				element.setAttribute('nonce', nonce);
		}
	};

	return new HTMLRewriter()
		.on('script', stamp)
		.on('style', stamp)
		.transform(new Response(html))
		.text();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const parseHtmxConfig = (content: string | null) => {
	try {
		const parsed: unknown = JSON.parse(content ?? '{}');

		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
};

/* htmx inserts its own indicator <style> at runtime, which a nonce-based
 * policy blocks unless htmx knows the nonce: it reads `inlineStyleNonce`
 * from <meta name="htmx-config">. Merged into an existing config, or added.
 * `inlineScriptNonce` is deliberately not set: htmx would put it on scripts
 * inside swapped fragments, which can carry data. */
export const withHtmxStyleNonce = async (
	html: string,
	nonce: string | undefined = readCspNonce()
) => {
	if (!nonce) return html;
	let found = false;
	const merged = await new HTMLRewriter()
		.on('meta[name="htmx-config"]', {
			element: (element) => {
				found = true;
				const config = parseHtmxConfig(element.getAttribute('content'));
				element.setAttribute(
					'content',
					JSON.stringify({ ...config, inlineStyleNonce: nonce })
				);
			}
		})
		.transform(new Response(html))
		.text();
	if (found) return merged;
	const meta = `<meta name="htmx-config" content='${JSON.stringify({ inlineStyleNonce: nonce })}'>`;
	const headClose = merged.search(/<\/head>/i);

	return headClose >= 0
		? `${merged.slice(0, headClose)}${meta}${merged.slice(headClose)}`
		: `${meta}${merged}`;
};
