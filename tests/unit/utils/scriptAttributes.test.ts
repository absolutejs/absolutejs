import { describe, expect, test } from 'bun:test';
import { generateHeadElement } from '../../../src/utils/generateHeadElement';
import {
	scriptAttributes,
	scriptIdentity,
	scriptTag
} from '../../../src/utils/scriptAttributes';

/* A third-party tag had no supported form at all: there is no `<Script>`
 * in any framework's components, and `generateHeadElement` rendered meta,
 * preload links, speculation rules and JSON-LD but had no way to render a
 * script. A project wrote the tag into its markup by hand, which is also
 * how it ended up running again on every soft navigation. */

describe('what a strategy renders', () => {
	/* `defer` by default: a third-party tag that blocks parsing is the
	 * thing this exists to avoid. */
	test('afterInteractive defers', () => {
		expect(scriptAttributes({ src: '/a.js' })).toEqual({
			'data-absolute-script': '/a.js',
			defer: '',
			src: '/a.js'
		});
	});

	/* A script asked to run before the page is interactive cannot also be
	 * deferred, which would be a contradiction rather than a nuance. */
	test('beforeInteractive defers nothing', () => {
		expect(
			scriptAttributes({ src: '/a.js', strategy: 'beforeInteractive' })
		).toEqual({
			'data-absolute-script': '/a.js',
			src: '/a.js'
		});
	});

	test('async wins over the default defer, never both', () => {
		const attributes = scriptAttributes({ async: true, src: '/a.js' });

		expect(attributes).toHaveProperty('async', '');
		expect(attributes).not.toHaveProperty('defer');
	});

	/* `lazyOnload` is the one strategy with nothing in the document: the
	 * tag is added once the window has loaded. */
	test('lazyOnload renders no tag', () => {
		expect(
			scriptAttributes({ src: '/a.js', strategy: 'lazyOnload' })
		).toBeUndefined();
	});

	/* `defer` and `async` are attributes of a fetch, so an inline script
	 * takes neither. */
	test('an inline script takes neither defer nor async', () => {
		const attributes = scriptAttributes({ code: 'x=1', id: 'inline' });

		expect(attributes).not.toHaveProperty('defer');
		expect(attributes).not.toHaveProperty('async');
	});

	/* Third-party tags are configured through data attributes more often
	 * than through anything else. */
	test('data attributes are prefixed', () => {
		expect(
			scriptAttributes({ data: { domain: 'x.com' }, src: '/a.js' })
		).toHaveProperty('data-domain', 'x.com');
	});
});

describe('identity, which is what stops a second run', () => {
	test('an explicit id wins over src', () => {
		expect(scriptIdentity({ id: 'analytics', src: '/a.js' })).toBe(
			'analytics'
		);
	});

	test('src is the identity when there is no id', () => {
		expect(scriptIdentity({ src: '/a.js' })).toBe('/a.js');
	});

	/* An inline script with no id has no identity, and is left to behave
	 * like any other inline script rather than being given a made-up one:
	 * two different inline snippets must not collapse into one. */
	test('an inline script with no id carries no marker', () => {
		expect(scriptAttributes({ code: 'x=1' })).not.toHaveProperty(
			'data-absolute-script'
		);
	});
});

describe('the string form, for a head built without components', () => {
	test('renders the tag with its nonce', () => {
		expect(scriptTag({ src: '/a.js' }, 'abc123')).toBe(
			'<script data-absolute-script="/a.js" src="/a.js" defer nonce="abc123"></script>'
		);
	});

	/* The hazard is not hypothetical in code pasted out of a tag manager:
	 * a literal `</script` would close the element early and spill the
	 * rest of the page as markup. */
	test('inline source cannot close the element early', () => {
		const tag = scriptTag({ code: 'var a="</script>";', id: 'x' });

		expect(tag).not.toContain('</script>";');
		expect(tag).toContain('<\\/script');
	});

	test('a lazy script renders a bootstrap that checks the document first', () => {
		const tag = scriptTag({ src: '/a.js', strategy: 'lazyOnload' });

		expect(tag).toContain('addEventListener("load"');
		expect(tag).toContain('querySelector');
		expect(tag).not.toContain('<script src=');
	});

	/* Same hazard, through the JSON payload rather than the source. */
	test('a bootstrap value cannot close the element early', () => {
		const tag = scriptTag({
			src: 'https://x.test/</script><img>',
			strategy: 'lazyOnload'
		});

		expect(tag).not.toContain('</script><img>');
	});
});

describe('the head element', () => {
	test('carries the scripts it was given', () => {
		const head = generateHeadElement({
			scripts: [{ data: { domain: 'x' }, src: '/a.js' }]
		});

		expect(head).toContain('<script data-absolute-script="/a.js"');
		expect(head).toContain('data-domain="x"');
	});

	/* After the stylesheets: a deferred analytics script should not be
	 * fetched ahead of the CSS that decides what the page looks like. */
	test('after the page stylesheets', () => {
		const head = generateHeadElement({
			cssPath: '/page.css',
			scripts: [{ src: '/a.js' }]
		});

		expect(head.indexOf('/page.css')).toBeLessThan(head.indexOf('/a.js'));
	});

	test('no scripts, no script tags', () => {
		expect(generateHeadElement({ title: 'x' })).not.toContain(
			'data-absolute-script'
		);
	});
});
