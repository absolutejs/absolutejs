import { describe, expect, test } from 'bun:test';
import {
	type GuardRunContext,
	NavigationRedirect,
	redirect,
	runGuardChain
} from '../../../../src/svelte/router/guards';
import type { RouteGuard } from '../../../../types/svelteRouter';

const context: GuardRunContext = {
	from: null,
	request: undefined,
	to: new URL('http://localhost/dashboard'),
	type: 'goto'
};

const entry = (guard: RouteGuard, params = {}) => ({ guard, params });

describe('runGuardChain', () => {
	test('allows when every guard allows (undefined, true, nothing)', async () => {
		const decision = await runGuardChain(
			[entry(() => undefined), entry(() => true), entry(() => {})],
			context
		);

		expect(decision).toEqual({ kind: 'allow' });
	});

	test('runs guards in order and stops at the first that cancels', async () => {
		const ran: string[] = [];
		const decision = await runGuardChain(
			[
				entry(() => {
					ran.push('router');
				}),
				entry(() => {
					ran.push('route');

					return false;
				}),
				entry(() => {
					ran.push('never');
				})
			],
			context
		);

		expect(decision).toEqual({ kind: 'cancel' });
		expect(ran).toEqual(['router', 'route']);
	});

	test('a returned string or { redirect } redirects', async () => {
		expect(await runGuardChain([entry(() => '/login')], context)).toEqual({
			kind: 'redirect',
			location: '/login',
			replace: false
		});
		expect(
			await runGuardChain(
				[entry(() => ({ redirect: '/login', replace: true }))],
				context
			)
		).toEqual({ kind: 'redirect', location: '/login', replace: true });
	});

	test('redirect() works returned or thrown from a nested helper', async () => {
		const requireUser = () => {
			throw redirect('/login', { replace: true });
		};
		const thrown = await runGuardChain(
			[
				entry(async () => {
					await Promise.resolve();
					requireUser();
				})
			],
			context
		);
		const returned = await runGuardChain(
			[entry(() => redirect('/elsewhere'))],
			context
		);

		expect(thrown).toEqual({
			kind: 'redirect',
			location: '/login',
			replace: true
		});
		expect(returned).toEqual({
			kind: 'redirect',
			location: '/elsewhere',
			replace: false
		});
		expect(redirect('/x')).toBeInstanceOf(NavigationRedirect);
	});

	test('async guards are awaited and receive their params', async () => {
		const seen: unknown[] = [];
		await runGuardChain(
			[
				entry(
					async (navigation) => {
						await Bun.sleep(5);
						seen.push(navigation.params, navigation.to.pathname);
					},
					{ id: '42' }
				)
			],
			context
		);

		expect(seen).toEqual([{ id: '42' }, '/dashboard']);
	});

	test('a newer navigation makes the chain stale', async () => {
		let token = 1;
		const decision = await runGuardChain(
			[
				entry(async () => {
					token = 2;
					await Promise.resolve();
				}),
				entry(() => false)
			],
			context,
			() => token !== 1
		);

		expect(decision).toEqual({ kind: 'stale' });
	});

	test('other errors propagate', async () => {
		await expect(
			runGuardChain(
				[
					entry(() => {
						throw new Error('session store down');
					})
				],
				context
			)
		).rejects.toThrow('session store down');
	});
});
