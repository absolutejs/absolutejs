import { describe, expect, test } from 'bun:test';
import {
	compilePattern,
	matchPattern,
	comparePatterns,
	joinBasepath
} from '../../../../src/svelte/router/matchPath';

describe('compilePattern', () => {
	test('static-only path scores by static-segment count', () => {
		expect(compilePattern('/').score).toBe(0);
		expect(compilePattern('/a').score).toBe(100);
		expect(compilePattern('/a/b').score).toBe(200);
		expect(compilePattern('/a/b/c').score).toBe(300);
	});

	test('param segment scores lower than static', () => {
		expect(compilePattern('/users/:id').score).toBe(110);
		expect(compilePattern('/:a/:b').score).toBe(20);
	});

	test('optional param penalizes the param weight by 1', () => {
		expect(compilePattern('/users/:id?').score).toBe(109);
	});

	test('wildcard scores lowest', () => {
		expect(compilePattern('/*').score).toBe(1);
		expect(compilePattern('/files/*').score).toBe(101);
	});

	test('mixed pattern adds segment scores', () => {
		// /a/:b/* → 100 + 10 + 1 = 111
		expect(compilePattern('/a/:b/*').score).toBe(111);
	});

	test('trailing/leading slashes do not affect score', () => {
		expect(compilePattern('/a/b/').score).toBe(
			compilePattern('/a/b').score
		);
		expect(compilePattern('a/b').score).toBe(compilePattern('/a/b').score);
	});
});

describe('matchPattern — static paths', () => {
	test('exact match succeeds with empty params', () => {
		const result = matchPattern(compilePattern('/dashboard'), '/dashboard');
		expect(result.matched).toBe(true);
		if (result.matched) expect(result.params).toEqual({});
	});

	test('mismatched static segment fails', () => {
		expect(
			matchPattern(compilePattern('/dashboard'), '/settings').matched
		).toBe(false);
	});

	test('extra path segments fail (no implicit trailing wildcard)', () => {
		expect(
			matchPattern(compilePattern('/dashboard'), '/dashboard/x').matched
		).toBe(false);
	});

	test('missing path segments fail', () => {
		expect(
			matchPattern(compilePattern('/a/b/c'), '/a/b').matched
		).toBe(false);
	});

	test('root path matches "/" and ""', () => {
		const root = compilePattern('/');
		expect(matchPattern(root, '/').matched).toBe(true);
		expect(matchPattern(root, '').matched).toBe(true);
	});

	test('trailing slashes on input pathname are tolerated', () => {
		const result = matchPattern(
			compilePattern('/dashboard'),
			'/dashboard/'
		);
		expect(result.matched).toBe(true);
	});
});

describe('matchPattern — param paths', () => {
	test('single :param extracts value', () => {
		const result = matchPattern(compilePattern('/users/:id'), '/users/42');
		expect(result.matched).toBe(true);
		if (result.matched) expect(result.params).toEqual({ id: '42' });
	});

	test('multiple :params extract correctly', () => {
		const result = matchPattern(
			compilePattern('/users/:id/posts/:postId'),
			'/users/42/posts/abc'
		);
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ id: '42', postId: 'abc' });
		}
	});

	test(':param does not match across segments', () => {
		const result = matchPattern(
			compilePattern('/users/:id'),
			'/users/42/extra'
		);
		expect(result.matched).toBe(false);
	});

	test(':param matches a value containing dashes/dots', () => {
		const result = matchPattern(
			compilePattern('/files/:name'),
			'/files/my-file.tar.gz'
		);
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ name: 'my-file.tar.gz' });
		}
	});
});

describe('matchPattern — optional params', () => {
	test('optional :param? present yields the value', () => {
		const result = matchPattern(
			compilePattern('/users/:id?'),
			'/users/42'
		);
		expect(result.matched).toBe(true);
		if (result.matched) expect(result.params).toEqual({ id: '42' });
	});

	test('optional :param? missing yields undefined', () => {
		const result = matchPattern(compilePattern('/users/:id?'), '/users');
		expect(result.matched).toBe(true);
		if (result.matched) expect(result.params).toEqual({ id: undefined });
	});

	test('optional :param? at end allows shorter pathname to match', () => {
		const result = matchPattern(
			compilePattern('/a/:b/:c?'),
			'/a/foo'
		);
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ b: 'foo', c: undefined });
		}
	});
});

describe('matchPattern — wildcards', () => {
	test('lone wildcard matches anything (root included)', () => {
		const result = matchPattern(compilePattern('/*'), '/anything/here');
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ wildcard: 'anything/here' });
		}
	});

	test('wildcard captures rest of path including slashes', () => {
		const result = matchPattern(
			compilePattern('/files/*'),
			'/files/a/b/c.txt'
		);
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ wildcard: 'a/b/c.txt' });
		}
	});

	test('wildcard with no remaining segments yields empty wildcard', () => {
		const result = matchPattern(compilePattern('/files/*'), '/files');
		expect(result.matched).toBe(true);
		if (result.matched) expect(result.params).toEqual({ wildcard: '' });
	});

	test('wildcard combined with param earlier in path', () => {
		const result = matchPattern(
			compilePattern('/users/:id/files/*'),
			'/users/42/files/a/b/c'
		);
		expect(result.matched).toBe(true);
		if (result.matched) {
			expect(result.params).toEqual({ id: '42', wildcard: 'a/b/c' });
		}
	});
});

describe('comparePatterns — specificity ranking', () => {
	test('higher score sorts first', () => {
		const a = { score: 200, index: 5 };
		const b = { score: 100, index: 0 };
		expect(comparePatterns(a, b)).toBeLessThan(0);
		expect(comparePatterns(b, a)).toBeGreaterThan(0);
	});

	test('equal score: earlier declaration index wins', () => {
		const a = { score: 100, index: 0 };
		const b = { score: 100, index: 5 };
		expect(comparePatterns(a, b)).toBeLessThan(0);
		expect(comparePatterns(b, a)).toBeGreaterThan(0);
	});

	test('static prefix beats parameterised at same length', () => {
		const staticPat = compilePattern('/users/me');
		const paramPat = compilePattern('/users/:id');
		expect(staticPat.score).toBeGreaterThan(paramPat.score);
	});

	test('most static segments wins among similar shapes', () => {
		// /a/b/:c (210) vs /a/:b/:c (120)
		const moreStatic = compilePattern('/a/b/:c');
		const lessStatic = compilePattern('/a/:b/:c');
		expect(moreStatic.score).toBeGreaterThan(lessStatic.score);
	});

	test('static beats wildcard at same depth', () => {
		expect(compilePattern('/a').score).toBeGreaterThan(
			compilePattern('/*').score
		);
	});
});

describe('joinBasepath', () => {
	test('empty basepath returns pattern with leading slash', () => {
		expect(joinBasepath('', '/users')).toBe('/users');
		expect(joinBasepath('', 'users')).toBe('/users');
	});

	test('basepath without trailing slash joined to pattern with leading slash', () => {
		expect(joinBasepath('/portal', '/users')).toBe('/portal/users');
	});

	test('basepath with trailing slash is normalized', () => {
		expect(joinBasepath('/portal/', '/users')).toBe('/portal/users');
	});

	test('pattern without leading slash is joined cleanly', () => {
		expect(joinBasepath('/portal', 'users')).toBe('/portal/users');
	});

	test('root pattern under basepath returns the basepath', () => {
		expect(joinBasepath('/portal', '/')).toBe('/portal');
		expect(joinBasepath('/portal/', '/')).toBe('/portal');
	});

	test('empty basepath + root pattern returns "/"', () => {
		expect(joinBasepath('', '/')).toBe('/');
	});

	test('multiple slashes are not duplicated', () => {
		expect(joinBasepath('/a/', '/b')).toBe('/a/b');
		expect(joinBasepath('/a//', '//b')).toBe('/a/b');
	});

	test('nested basepath stacking — caller chains joinBasepath', () => {
		// Simulates Router computing stackedBasepath, then a child Router
		// joining its own basepath onto that.
		const outer = joinBasepath('', '/portal'); // /portal
		const inner = joinBasepath(outer, '/admin'); // /portal/admin
		expect(joinBasepath(inner, '/users')).toBe('/portal/admin/users');
	});
});
