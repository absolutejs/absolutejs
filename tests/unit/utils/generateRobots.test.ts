import { describe, expect, test } from 'bun:test';
import {
	AI_ASSISTANT_AGENTS,
	AI_SEARCH_CRAWLERS,
	AI_TRAINING_CRAWLERS
} from '../../../src/constants';
import { generateRobots } from '../../../src/utils/generateRobots';
import { renderRobotsContent } from '../../../src/utils/headEscape';

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

describe('ai', () => {
	test('writes a group for each kind turned off, after the rules', () => {
		expect(
			generateRobots({
				ai: { search: true, training: false },
				rules: [{ disallow: '/admin' }]
			})
		).toBe(
			[
				'User-agent: *',
				'Disallow: /admin',
				'',
				...AI_TRAINING_CRAWLERS.map((name) => `User-agent: ${name}`),
				'Disallow: /',
				''
			].join('\n')
		);
	});

	test('keeps the kinds apart', () => {
		const text = generateRobots({
			ai: { assistants: false, search: false, training: false }
		});
		const [everyone, ...groups] = text.trim().split('\n\n');

		expect(everyone).toBe('User-agent: *\nAllow: /');
		expect(groups.map((group) => group.split('\n')[0])).toEqual([
			`User-agent: ${AI_TRAINING_CRAWLERS[0]}`,
			`User-agent: ${AI_SEARCH_CRAWLERS[0]}`,
			`User-agent: ${AI_ASSISTANT_AGENTS[0]}`
		]);
	});

	test('writes nothing for a kind left on, or for none', () => {
		expect(generateRobots({ ai: {} })).toBe(generateRobots(true));
		expect(generateRobots({ ai: { training: true } })).toBe(
			generateRobots(true)
		);
	});

	/* Disallowing the name a search crawler looks for is not disallowing
	 * the search crawler. */
	test('names the training tokens, not the search crawlers behind them', () => {
		expect(AI_TRAINING_CRAWLERS).toContain('Google-Extended');
		expect(AI_TRAINING_CRAWLERS).not.toContain('Googlebot');
		expect(AI_SEARCH_CRAWLERS).not.toContain('GPTBot');
	});
});

describe('a page’s own directive', () => {
	test('can ask not to be trained on', () => {
		expect(
			renderRobotsContent({ index: true, noai: true, noimageai: true })
		).toBe('index, noai, noimageai');
	});
});
