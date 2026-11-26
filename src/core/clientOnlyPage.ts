/* A page with `ssr: false`: the document shell, and nothing rendered.
 *
 * Every framework's generated client entry already knows how to mount a
 * page into an empty document instead of hydrating one — the mobile
 * client drives them that way — and chooses by one flag,
 * `window.__ABSOLUTE_PAGE_RENDER_MODE__`. So skipping the server render
 * is a matter of sending the same document the server would have sent,
 * with nothing inside the page's root, and that flag set before the
 * entry runs.
 *
 * The flag has to be set here rather than left to the entry to infer
 * from an empty root: a page that legitimately renders nothing would
 * look the same, and hydrating onto markup that was never rendered is a
 * mismatch error, not a blank page. */

import { HTML_CONTENT_TYPE } from '../constants';
import { nonceAttr } from '../utils/cspNonceRef';
import { escapeScriptContent } from '../utils/escapeScriptContent';
import { htmlLangAttributes } from '../utils/localeRef';

export const CLIENT_RENDER_MODE_SCRIPT =
	'window.__ABSOLUTE_PAGE_RENDER_MODE__="client";';

type ClientOnlyDocument = {
	/** The inline script that hands the page its props and loads its
	 *  entry. The render-mode flag is written in front of it. */
	bootstrap: string;
	/** A complete `<head>…</head>`. */
	head: string;
	/** What goes in `<body>` ahead of the scripts: the empty element the
	 *  framework mounts into, if it needs one. */
	root: string;
	/** Markup after the inline script: a module script tag, for the
	 *  frameworks that load their entry that way. */
	tail?: string;
};

export const clientOnlyDocument = ({
	bootstrap,
	head,
	root,
	tail = ''
}: ClientOnlyDocument) =>
	`<!DOCTYPE html><html${htmlLangAttributes()}>${head}<body>${root}<script${nonceAttr()}>${escapeScriptContent(`${CLIENT_RENDER_MODE_SCRIPT}${bootstrap}`)}</script>${tail}</body></html>`;

/** The response for a page that is not rendered on the server. Cache
 *  headers are the caller's to add, through the same wrapper a rendered
 *  page goes through. */
export const clientOnlyResponse = (document: ClientOnlyDocument) =>
	new Response(clientOnlyDocument(document), {
		headers: { 'Content-Type': HTML_CONTENT_TYPE }
	});
