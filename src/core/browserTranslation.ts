const BASELINE_MARKER = '__ABSOLUTE_SSR_TEXT_BASELINES__';

/** Inline this after SSR markup and before any client entry executes. The
 * snapshot records server-authored text while keeping it out of the DOM, so
 * browser translation remains free to edit the rendered text. */
export const BROWSER_TRANSLATION_BASELINE_SCRIPT =
	'window.__ABSOLUTE_SSR_TEXT_BASELINES__=new WeakMap();' +
	'{const r=document.body,b=window.__ABSOLUTE_SSR_TEXT_BASELINES__;' +
	'if(r)for(const e of [r,...r.querySelectorAll("*")]){' +
	'const t=new Map();for(const [i,n]of[...e.childNodes].entries())' +
	'if(n.nodeType===3)t.set(i,n.nodeValue??"");if(t.size)b.set(e,t);}}';

export const browserTranslationBaselineTag = () =>
	`<script>${BROWSER_TRANSLATION_BASELINE_SCRIPT}</script>`;

export const injectBrowserTranslationBaseline = (html: string) => {
	if (html.includes(BASELINE_MARKER)) return html;
	const script = browserTranslationBaselineTag();
	const closingBodyIndex = html.lastIndexOf('</body>');
	if (closingBodyIndex < 0) return `${html}${script}`;

	return `${html.slice(0, closingBodyIndex)}${script}${html.slice(closingBodyIndex)}`;
};
