import { describe, expect, test } from 'bun:test';
import {
	createAbsoluteMobileNavigationCoordinator,
	type AbsoluteMobileNavigationRequest
} from '../../../src/mobile/navigationLifecycle';

const request = (path: string): AbsoluteMobileNavigationRequest => ({
	direction: 'forward',
	from: '/',
	historyMode: 'push',
	path
});

const deferred = <Value>() => Promise.withResolvers<Value>();

describe('mobile navigation lifecycle', () => {
	test('aborts an older load and commits only the latest destination', async () => {
		const loads = new Map<string, ReturnType<typeof deferred<string>>>();
		const committed: string[] = [];
		const coordinator = createAbsoluteMobileNavigationCoordinator<string>({
			commit: async (path) => {
				committed.push(path);
			},
			load: (navigation, signal) => {
				const load = deferred<string>();
				loads.set(navigation.path, load);
				signal.addEventListener(
					'abort',
					() =>
						load.reject(
							new DOMException('Superseded', 'AbortError')
						),
					{ once: true }
				);

				return load.promise;
			}
		});
		const first = coordinator.navigate(request('/slow'));
		const second = coordinator.navigate(request('/latest'));
		loads.get('/latest')?.resolve('/latest');

		expect(await first).toEqual({ kind: 'cancelled' });
		expect(await second).toEqual({ kind: 'committed' });
		expect(committed).toEqual(['/latest']);
		expect(coordinator.phase()).toBe('idle');
	});

	test('serializes document commits when a newer request arrives mid-commit', async () => {
		const releaseFirst = deferred<void>();
		const order: string[] = [];
		let activeCommits = 0;
		let maximumActiveCommits = 0;
		const coordinator = createAbsoluteMobileNavigationCoordinator<string>({
			commit: async (path) => {
				activeCommits += 1;
				maximumActiveCommits = Math.max(
					maximumActiveCommits,
					activeCommits
				);
				order.push(`start:${path}`);
				if (path === '/first') await releaseFirst.promise;
				order.push(`end:${path}`);
				activeCommits -= 1;
			},
			load: async ({ path }) => path
		});
		const first = coordinator.navigate(request('/first'));
		await Promise.resolve();
		await Promise.resolve();
		const second = coordinator.navigate(request('/second'));
		releaseFirst.resolve();

		expect(await first).toEqual({ kind: 'cancelled' });
		expect(await second).toEqual({ kind: 'committed' });
		expect(maximumActiveCommits).toBe(1);
		expect(order).toEqual([
			'start:/first',
			'end:/first',
			'start:/second',
			'end:/second'
		]);
	});

	test('cancels Back-during-load without entering the commit boundary', async () => {
		const load = deferred<string>();
		let committed = false;
		const coordinator = createAbsoluteMobileNavigationCoordinator<string>({
			commit: async () => {
				committed = true;
			},
			load: (_navigation, signal) => {
				signal.addEventListener(
					'abort',
					() => load.reject(new DOMException('Back', 'AbortError')),
					{ once: true }
				);

				return load.promise;
			}
		});
		const navigation = coordinator.navigate(request('/slow'));

		expect(coordinator.cancelPending()).toBe(true);
		expect(await navigation).toEqual({ kind: 'cancelled' });
		expect(committed).toBe(false);
		expect(coordinator.cancelPending()).toBe(false);
	});

	test('reports load and commit failures separately', async () => {
		const phases: string[] = [];
		const loadFailure = createAbsoluteMobileNavigationCoordinator<string>({
			commit: async () => undefined,
			load: async () => {
				throw new Error('offline');
			},
			onFailure: (_error, phase) => phases.push(phase)
		});
		const commitFailure = createAbsoluteMobileNavigationCoordinator<string>(
			{
				commit: async () => {
					throw new Error('render');
				},
				load: async () => 'page',
				onFailure: (_error, phase) => phases.push(phase)
			}
		);

		expect((await loadFailure.navigate(request('/offline'))).kind).toBe(
			'failed'
		);
		expect((await commitFailure.navigate(request('/broken'))).kind).toBe(
			'failed'
		);
		expect(phases).toEqual(['load', 'commit']);
	});
});
