import type { NavItem } from './navData';

// Static HTML/HTMX pages can't import `navData`, so the generator bakes a nav
// snapshot between these markers and rewrites it on every generate to keep the
// static surfaces in sync with the JS-framework pages.
export const NAV_MARKER_END = '<!-- /absolute:nav -->';
export const NAV_MARKER_START = '<!-- absolute:nav -->';

const escapeHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const indentBefore = (text: string, position: number) => {
	let index = position;
	while (index > 0 && text[index - 1] !== '\n') index -= 1;

	return text.slice(index, position);
};

// Renders the marker-delimited nav block. The leading indent of the opening
// marker is supplied by the caller (it stays outside the replaced region during
// re-sync); `indent` is applied to the inner <nav> lines.
export const renderNavBlock = (items: NavItem[], indent: string) => {
	const links = items
		.map(
			(item) =>
				`${indent}\t<a href="${escapeHtml(item.href)}">${escapeHtml(
					item.label
				)}</a>`
		)
		.join('\n');
	const body = links.length > 0 ? `\n${links}\n${indent}` : '';

	return `${NAV_MARKER_START}\n${indent}<nav>${body}</nav>\n${indent}${NAV_MARKER_END}`;
};

// Replaces the marked nav region of a static page with a fresh snapshot.
// Returns null when the page has no markers (hand-written page — left untouched).
export const syncStaticNav = (html: string, items: NavItem[]) => {
	const startIdx = html.indexOf(NAV_MARKER_START);
	const endIdx = html.indexOf(NAV_MARKER_END);
	if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
	const indent = indentBefore(html, startIdx);
	const end = endIdx + NAV_MARKER_END.length;

	return (
		html.slice(0, startIdx) +
		renderNavBlock(items, indent) +
		html.slice(end)
	);
};
