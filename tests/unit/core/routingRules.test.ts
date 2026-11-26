import { describe, expect, test } from 'bun:test';
import {
	compileRoutingRules,
	decideRouting,
	headersFor,
	routingRuleProblems,
	staticHostRuleFiles
} from '../../../src/core/routingRules';
import type { RoutingRulesConfig } from '../../../types/routingRules';

const decide = (config: RoutingRulesConfig, path: string) => {
	const url = new URL(path, 'http://localhost');

	return decideRouting(compileRoutingRules(config), url.pathname, url.search);
};

describe('redirects', () => {
	test('a literal path, 308 unless told otherwise', () => {
		const config: RoutingRulesConfig = {
			redirects: [
				{ from: '/old-pricing', to: '/plans/pricing' },
				{ from: '/moved', status: 301, to: '/here' }
			]
		};

		expect(decide(config, '/old-pricing')).toEqual({
			kind: 'redirect',
			location: '/plans/pricing',
			status: 308
		});
		expect(decide(config, '/moved')).toEqual({
			kind: 'redirect',
			location: '/here',
			status: 301
		});
		expect(decide(config, '/other')).toEqual({ kind: 'none' });
	});

	test('a trailing slash on the request does not change the answer', () => {
		const config: RoutingRulesConfig = {
			redirects: [{ from: '/old', to: '/new' }]
		};

		expect(decide(config, '/old/')).toMatchObject({ location: '/new' });
	});

	test(':name carries one segment across, as it arrived', () => {
		const config: RoutingRulesConfig = {
			redirects: [{ from: '/blog/:slug', to: '/posts/:slug' }]
		};

		expect(decide(config, '/blog/hello')).toMatchObject({
			location: '/posts/hello'
		});
		// Still encoded: decoding it would change which post this is.
		expect(decide(config, '/blog/a%2Fb%20c')).toMatchObject({
			location: '/posts/a%2Fb%20c'
		});
		// One segment exactly: neither fewer nor more.
		expect(decide(config, '/blog')).toEqual({ kind: 'none' });
		expect(decide(config, '/blog/a/b')).toEqual({ kind: 'none' });
	});

	test('a final * carries the rest, which may be nothing', () => {
		const config: RoutingRulesConfig = {
			redirects: [
				{ from: '/docs/*', to: 'https://docs.example.com/v2/*' }
			]
		};

		expect(decide(config, '/docs/guide/install')).toMatchObject({
			location: 'https://docs.example.com/v2/guide/install'
		});
		expect(decide(config, '/docs')).toMatchObject({
			location: 'https://docs.example.com/v2'
		});
		expect(decide(config, '/documents')).toEqual({ kind: 'none' });
	});

	test('the query string follows, unless the destination names its own', () => {
		const config: RoutingRulesConfig = {
			redirects: [
				{ from: '/a', to: '/b' },
				{ from: '/c', to: '/d?fixed=1' },
				{ from: '/e', to: '/f#part' }
			]
		};

		expect(decide(config, '/a?ref=mail')).toMatchObject({
			location: '/b?ref=mail'
		});
		expect(decide(config, '/c?ref=mail')).toMatchObject({
			location: '/d?fixed=1'
		});
		expect(decide(config, '/e?ref=mail')).toMatchObject({
			location: '/f?ref=mail#part'
		});
	});

	test('the first matching rule answers', () => {
		const config: RoutingRulesConfig = {
			redirects: [
				{ from: '/shop/sale', to: '/sale' },
				{ from: '/shop/:item', to: '/products/:item' }
			]
		};

		expect(decide(config, '/shop/sale')).toMatchObject({
			location: '/sale'
		});
		expect(decide(config, '/shop/hat')).toMatchObject({
			location: '/products/hat'
		});
	});
});

describe('rewrites', () => {
	test('answer with the path to serve, and only after redirects', () => {
		const config: RoutingRulesConfig = {
			redirects: [{ from: '/p/legacy', to: '/gone' }],
			rewrites: [{ from: '/p/:id', to: '/products/:id' }]
		};

		expect(decide(config, '/p/42?tab=reviews')).toEqual({
			kind: 'rewrite',
			pathname: '/products/42',
			search: '?tab=reviews'
		});
		expect(decide(config, '/p/legacy')).toMatchObject({
			kind: 'redirect'
		});
	});
});

describe("the framework's own paths", () => {
	test('are never redirected or rewritten, even by /*', () => {
		const config: RoutingRulesConfig = {
			redirects: [{ from: '/*', to: 'https://elsewhere.example/*' }]
		};

		expect(decide(config, '/__absolute/ready')).toEqual({ kind: 'none' });
		expect(decide(config, '/_absolute/image')).toEqual({ kind: 'none' });
		expect(decide(config, '/anything')).toMatchObject({
			kind: 'redirect'
		});
	});
});

describe('headers', () => {
	const rules = compileRoutingRules({
		headers: [
			{ headers: { 'X-Frame-Options': 'DENY' }, path: '/*' },
			{
				headers: { 'cache-control': 'public, max-age=31536000' },
				path: '/assets/*'
			},
			{ headers: { 'x-frame-options': 'SAMEORIGIN' }, path: '/embed/:id' }
		]
	});

	test('every matching rule applies, names lowercased', () => {
		expect(headersFor(rules, '/assets/app.js')).toEqual({
			'cache-control': 'public, max-age=31536000',
			'x-frame-options': 'DENY'
		});
		expect(headersFor(rules, '/')).toEqual({ 'x-frame-options': 'DENY' });
	});

	test('a later rule overrides an earlier one for the same header', () => {
		expect(headersFor(rules, '/embed/7')).toEqual({
			'x-frame-options': 'SAMEORIGIN'
		});
	});
});

describe('rules that are refused at startup', () => {
	const problems = (config: RoutingRulesConfig) =>
		routingRuleProblems(config);

	test('well-formed rules have no problems', () => {
		expect(
			problems({
				headers: [{ headers: { 'x-a': '1' }, path: '/*' }],
				redirects: [{ from: '/a/:id', to: '/b/:id' }],
				rewrites: [{ from: '/c/*', to: '/d/*' }]
			})
		).toEqual([]);
	});

	test.each([
		[
			'a pattern with no leading slash',
			{ redirects: [{ from: 'old', to: '/new' }] },
			'redirects[0].from must be a path starting with "/".'
		],
		[
			'a * that is not last',
			{ redirects: [{ from: '/a/*/b', to: '/c' }] },
			'redirects[0].from may use "*" only as its last segment.'
		],
		[
			'a destination using a name the pattern does not capture',
			{ redirects: [{ from: '/a/:id', to: '/b/:slug' }] },
			'redirects[0].to uses :slug, which "/a/:id" does not capture.'
		],
		[
			'a * in the destination with none in the pattern',
			{ rewrites: [{ from: '/a', to: '/b/*' }] },
			'rewrites[0].to uses "*", but "/a" has no "*" to fill it.'
		],
		[
			'a rewrite to another site',
			{ rewrites: [{ from: '/a', to: 'https://other.example/a' }] },
			'rewrites[0].to must be a path of this app; a rewrite cannot serve another site. Use a redirect, or proxy in a route.'
		],
		[
			'a header value with a line break',
			{ headers: [{ headers: { 'x-a': 'one\r\ntwo' }, path: '/*' }] },
			'headers[0].headers.x-a contains a line break.'
		],
		[
			'a header name that is not one',
			{ headers: [{ headers: { 'bad name': '1' }, path: '/*' }] },
			'headers[0].headers has "bad name", which is not a valid header name.'
		],
		[
			'a rule an earlier one already answers',
			{
				redirects: [
					{ from: '/a', to: '/b' },
					{ from: '/a', to: '/c' }
				]
			},
			'redirects[1] can never match: redirects[0] already answers "/a".'
		],
		[
			'redirects that go in a circle',
			{
				redirects: [
					{ from: '/a', to: '/b' },
					{ from: '/b', to: '/a' }
				]
			},
			'redirects loop: /a -> /b -> /a.'
		]
	])('%s', (_label, config: RoutingRulesConfig, expected) => {
		expect(problems(config)).toEqual([expected]);
	});

	test('a status that is not a redirect, even when the type was bypassed', () => {
		const config: RoutingRulesConfig = {
			redirects: [
				// @ts-expect-error 200 is not a RedirectStatus.
				{ from: '/a', status: 200, to: '/b' }
			]
		};

		expect(problems(config)).toEqual([
			'redirects[0].status must be one of 301, 302, 303, 307, 308, got 200.'
		]);
	});

	test('compiling them throws with every problem listed', () => {
		expect(() =>
			compileRoutingRules({
				redirects: [
					{ from: 'old', to: '/new' },
					{ from: '/x/:id', to: '/y/:other' }
				]
			})
		).toThrow(
			/have problems:\n {2}- redirects\[0\]\.from must be a path starting with "\/"\.\n {2}- redirects\[1\]\.to uses :other/
		);
	});
});

describe('the files a static host reads', () => {
	test('redirects and rewrites become _redirects, headers become _headers', () => {
		expect(
			staticHostRuleFiles({
				headers: [
					{ headers: { 'x-frame-options': 'DENY' }, path: '/*' },
					{
						headers: {
							'cache-control': 'public, max-age=600',
							'x-robots-tag': 'noindex'
						},
						path: '/assets/*'
					}
				],
				redirects: [
					{ from: '/old', to: '/new' },
					{ from: '/blog/:slug', status: 301, to: '/posts/:slug' },
					{ from: '/docs/*', to: 'https://docs.example.com/*' }
				],
				rewrites: [{ from: '/p/:id', to: '/products/:id' }]
			})
		).toEqual({
			headers:
				'/*\n  x-frame-options: DENY\n\n/assets/*\n  cache-control: public, max-age=600\n  x-robots-tag: noindex\n',
			redirects:
				'/old /new 308\n/blog/:slug /posts/:slug 301\n/docs/* https://docs.example.com/:splat 308\n/p/:id /products/:id 200\n'
		});
	});

	test('nothing to write is null, not an empty file', () => {
		expect(staticHostRuleFiles({})).toEqual({
			headers: null,
			redirects: null
		});
	});

	test('malformed rules are refused here too', () => {
		expect(() =>
			staticHostRuleFiles({ redirects: [{ from: 'old', to: '/new' }] })
		).toThrow(/redirects\[0\]\.from/);
	});
});
