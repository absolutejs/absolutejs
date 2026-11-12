import { readFile, writeFile } from 'node:fs/promises';
import type { FontAssets } from '../../../types/fonts';
import { renderFontTags } from '../../utils/fontAssets';
import { scanEntryPoints } from '../scanEntryPoints';

const HEAD_CLOSE = /<\/head\s*>/i;
const STYLESHEET_LINK = /<link[^>]*rel=["']stylesheet["'][^>]*>/i;

/** Adds the font preloads and stylesheet to a static page's `<head>`,
 *  ahead of the page's own stylesheets so they can use the font
 *  variables. Pages that already link the stylesheet, or have no head,
 *  are left alone. */
export const injectFontHead = (html: string, fonts: FontAssets) => {
	const tags = renderFontTags(fonts);
	if (tags.length === 0) return html;
	if (fonts.stylesheets.some((href) => html.includes(href))) return html;
	const headClose = HEAD_CLOSE.exec(html);
	if (!headClose) return html;
	const firstStylesheet = STYLESHEET_LINK.exec(
		html.slice(0, headClose.index)
	);
	const insertAt = firstStylesheet ? firstStylesheet.index : headClose.index;

	return `${html.slice(0, insertAt)}${tags.join('\n\t\t')}\n\t\t${html.slice(insertAt)}`;
};

export const injectFontTags = async (directory: string, fonts: FontAssets) => {
	const pages = await scanEntryPoints(directory, '*.html');
	await Promise.all(
		pages.map(async (page) => {
			const html = await readFile(page, 'utf8');
			const updated = injectFontHead(html, fonts);
			if (updated !== html) await writeFile(page, updated);
		})
	);
};
