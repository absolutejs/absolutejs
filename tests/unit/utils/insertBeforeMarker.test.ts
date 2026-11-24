import { describe, expect, test } from 'bun:test';
import { injectSsrScripts } from '../../../src/angular/ssrRender';
import { injectInlineCss } from '../../../src/utils/inlinePageCss';
import { insertBeforeMarker } from '../../../src/utils/insertBeforeMarker';

/* `html.replace(marker, snippet + marker)` is not a literal insertion. In
 * a replacement STRING, `$&` is the match, `` $` `` the text before it,
 * `$'` the text after it and `$$` one dollar sign — so a snippet carrying
 * data is rewritten on its way into the page.
 *
 * Both of these were live. Request context `{ price: "$'" }` reached the
 * browser as `"</html>"`. And `$'` is not exotic in CSS: it is what
 * `a[href$='.pdf']` contains. */

const PAGE =
	'<html><head><title>t</title></head><body><p>page</p></body></html>';

const readRequestContext = (html: string) => {
	const match = /__ABS_ANGULAR_REQUEST_CONTEXT__ = (.*?);<\/script>/su.exec(
		html
	);
	if (match?.[1] === undefined) throw new Error('no request context');
	const parsed: unknown = JSON.parse(match[1]);

	return parsed;
};

describe('inserting before a marker', () => {
	test('puts the snippet immediately before it', () => {
		expect(insertBeforeMarker('a</b>c', '</b>', 'X')).toBe('aX</b>c');
	});

	test('uses the first marker when there are several', () => {
		expect(insertBeforeMarker('</b></b>', '</b>', 'X')).toBe('X</b></b>');
	});

	test('reports a missing marker instead of guessing', () => {
		expect(insertBeforeMarker('abc', '</b>', 'X')).toBeNull();
	});

	test.each(['$&', "$'", '$`', '$$', '$1'])(
		'treats %s as text, not as a pattern',
		(pattern) => {
			expect(insertBeforeMarker('a</b>c', '</b>', pattern)).toBe(
				`a${pattern}</b>c`
			);
		}
	);
});

describe('the request context an Angular page sends to the browser', () => {
	test('arrives as it was sent, dollar signs included', () => {
		const context: Record<string, string> = {
			after: "$'",
			before: '$`',
			doubled: 'costs $$5',
			match: 'cost is $& today'
		};

		expect(
			readRequestContext(
				injectSsrScripts(PAGE, 'req-dollar', '', context)
			)
		).toEqual(context);
	});

	/* The five snippets used to be five separate insertions. Collapsing
	 * them into one must not reorder them: the client bootstrap is last
	 * because it reads the globals the earlier ones set. */
	test('keeps its scripts in order, with the bootstrap last', () => {
		const html = injectSsrScripts(
			PAGE,
			'req-order',
			'/angular/index.js',
			{ ok: true },
			'/portal/'
		);
		const context = html.indexOf('__ABS_ANGULAR_REQUEST_CONTEXT__');
		const baseHref = html.indexOf('__ABS_ANGULAR_BASE_HREF__');
		const bootstrap = html.indexOf('import("/angular/index.js")');

		expect(context).toBeGreaterThan(html.indexOf('<p>page</p>'));
		expect(baseHref).toBeGreaterThan(context);
		expect(bootstrap).toBeGreaterThan(baseHref);
		expect(html.indexOf('</body>')).toBeGreaterThan(bootstrap);
	});

	test('still lands somewhere when the page has no </body>', () => {
		expect(
			injectSsrScripts('<html><p>x</p></html>', 'req-nobody', '', {
				ok: true
			})
		).toMatch(/__ABS_ANGULAR_REQUEST_CONTEXT__.*<\/html>$/su);
		expect(
			injectSsrScripts('<p>x</p>', 'req-bare', '', { ok: true })
		).toContain('__ABS_ANGULAR_REQUEST_CONTEXT__');
	});
});

describe('page CSS inlined into the head', () => {
	/* An ends-with attribute selector — nothing unusual — carries `$'`. */
	test('survives an attribute selector with a dollar sign', () => {
		const css = "a[href$='.pdf']{color:red}";
		const head = injectInlineCss('<head><title>t</title></head>', css);

		expect(head).toContain(css);
		expect(head.endsWith('</style></head>')).toBe(true);
		expect(head.match(/<\/head>/gu)).toHaveLength(1);
	});

	test('leaves the head alone when there is no CSS', () => {
		expect(injectInlineCss('<head></head>', '')).toBe('<head></head>');
	});
});
