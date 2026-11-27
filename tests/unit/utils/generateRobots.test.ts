import { describe, expect, test } from 'bun:test';
import { generateRobots } from '../../../src/utils/generateRobots';

/* The text of the `robots.txt` the build writes from the `robots`
 * config key. */

describe('robots: true', () => {
	test('allows every crawler everything', () => {
		expect(generateRobots(true)).toBe('User-agent: *\nAllow: /\n');
	});

	test('points at the build’s sitemap when the site’s address is known', () => {
		expect(generateRobots(true, 'https://acme.test')).toBe(
			'User-agent: *\nAllow: /\n\nSitemap: https://acme.test/sitemap.xml\n'
		);
	});

	test('whatever the address ends with', () => {
		expect(generateRobots(true, 'https://acme.test/')).toContain(
			'Sitemap: https://acme.test/sitemap.xml'
		);
	});
});

describe('rules', () => {
	test('are written a group each, in the order given', () => {
		expect(
			generateRobots({
				rules: [
					{ disallow: ['/admin', '/account'], userAgent: '*' },
					{ disallow: '/', userAgent: ['GPTBot', 'CCBot'] }
				]
			})
		).toBe(
			[
				'User-agent: *',
				'Disallow: /admin',
				'Disallow: /account',
				'',
				'User-agent: GPTBot',
				'User-agent: CCBot',
				'Disallow: /',
				''
			].join('\n')
		);
	});

	test('a group for no one in particular is for everyone', () => {
		expect(generateRobots({ rules: [{ disallow: '/private' }] })).toBe(
			'User-agent: *\nDisallow: /private\n'
		);
	});

	/* A group has to say something. */
	test('a group with no paths allows everything', () => {
		expect(generateRobots({ rules: [{ userAgent: 'Bingbot' }] })).toBe(
			'User-agent: Bingbot\nAllow: /\n'
		);
	});

	test('allow, disallow and a delay together', () => {
		expect(
			generateRobots({
				rules: [
					{
						allow: '/public',
						crawlDelay: 10,
						disallow: '/',
						userAgent: 'SlowBot'
					}
				]
			})
		).toBe(
			'User-agent: SlowBot\nAllow: /public\nDisallow: /\nCrawl-delay: 10\n'
		);
	});

	test('none given is the same as `true`', () => {
		expect(generateRobots({ rules: [] })).toBe(generateRobots(true));
		expect(generateRobots({})).toBe(generateRobots(true));
	});
});

describe('the Sitemap line', () => {
	test('can name sitemaps outright', () => {
		expect(
			generateRobots({
				sitemap: ['https://a.test/one.xml', 'https://a.test/two.xml']
			})
		).toBe(
			'User-agent: *\nAllow: /\n\nSitemap: https://a.test/one.xml\nSitemap: https://a.test/two.xml\n'
		);
	});

	test('can be left out', () => {
		expect(generateRobots({ sitemap: false }, 'https://acme.test')).toBe(
			'User-agent: *\nAllow: /\n'
		);
	});

	/* A sitemap's address has to be absolute, and a build that was not
	 * told the site's address does not know it. */
	test('is not written when the site’s address is not known', () => {
		expect(generateRobots({ sitemap: true })).not.toContain('Sitemap');
	});
});

describe('a value with a line break in it', () => {
	/* Whatever follows the break would be a line of the file's own. */
	test('stays on its line', () => {
		const text = generateRobots({
			rules: [{ disallow: '/a\nAllow: /', userAgent: 'x\nUser-agent: *' }]
		});

		expect(text.split('\n')).toEqual([
			'User-agent: x User-agent: *',
			'Disallow: /a Allow: /',
			''
		]);
	});
});
