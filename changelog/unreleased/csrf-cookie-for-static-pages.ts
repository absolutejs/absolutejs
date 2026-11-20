import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Token mode promised that a pre-rendered or static page, which cannot embed a per-visitor token, would have its browser helpers read the absolute_csrf cookie and send it as a header. The cookie was only issued by a page that rendered a token, so a visitor whose first stop was such a page had no cookie, the helpers had nothing to send, and every submission from that page was refused — with or without JavaScript. Once any route opts into tokens, every HTML page now issues the cookie, including pages that embed nothing. Only a page that embedded the token is marked private, no-store; a page that merely received the cookie keeps its caching, which is the point of pre-rendering it. An app with no token routes issues no cookie and still needs no secret. Found by the browser matrix that is Phase 3's exit criterion, which reaches the app through a proxy stripping Origin and Sec-Fetch-Site. Note the limitation that remains: a static HTML page under token mode needs JavaScript, because there is no field to render into one file served to every visitor.",
	kind: 'fixed',
	summary: 'A static or pre-rendered page can submit under CSRF token mode',
	symbols: ['getCsrfToken']
};
