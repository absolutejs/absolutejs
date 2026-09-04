import { describe, expect, test } from 'bun:test';
import {
	dependencyOrderedSequence,
	prioritiseByDependencies,
	runWhenIdle
} from '../../../src/dev/idleScheduler';

/* The idle scheduler is what keeps the after-listen module prewarm from
 * competing with the first request and its on-demand page build. Its whole
 * contract is timing-shaped, so the tests drive it with an injected
 * `sleep` and a scripted `isBusy` instead of real timers. */

const immediateSleep = () => Promise.resolve();

describe('runWhenIdle', () => {
	test('runs every task and reports the count', async () => {
		const ran: number[] = [];
		const tasks = [1, 2, 3, 4, 5].map((value) => () => {
			ran.push(value);
		});

		const completed = await runWhenIdle(tasks, {
			batchSize: 2,
			sleep: immediateSleep,
			isBusy: () => false
		}).done;

		expect(ran).toEqual([1, 2, 3, 4, 5]);
		expect(completed).toBe(5);
	});

	test('waits while the server is busy and resumes when it goes idle', async () => {
		const ran: string[] = [];
		let busy = true;
		let polls = 0;
		const completed = await runWhenIdle(
			['a', 'b'].map((value) => () => {
				ran.push(value);
			}),
			{
				batchSize: 1,
				isBusy: () => busy,
				sleep: () => {
					polls += 1;
					// Third poll: the request finished.
					if (polls === 3) busy = false;

					return Promise.resolve();
				}
			}
		).done;

		expect(polls).toBeGreaterThanOrEqual(3);
		expect(ran).toEqual(['a', 'b']);
		expect(completed).toBe(2);
	});

	test('a permanently busy server still makes progress after maxPauseMs', async () => {
		const ran: string[] = [];
		const completed = await runWhenIdle([() => ran.push('only')], {
			batchSize: 1,
			maxPauseMs: 20,
			pollMs: 10,
			sleep: immediateSleep,
			isBusy: () => true
		}).done;

		expect(ran).toEqual(['only']);
		expect(completed).toBe(1);
	});

	test('cancel stops the run without draining the remaining tasks', async () => {
		const ran: number[] = [];
		const run = runWhenIdle(
			Array.from({ length: 100 }, (_, index) => () => {
				ran.push(index);
				if (index === 1) run.cancel();
			}),
			{ batchSize: 2, sleep: immediateSleep, isBusy: () => false }
		);
		await run.done;

		expect(ran).toEqual([0, 1]);
	});

	test('yields to the event loop between batches', async () => {
		const order: string[] = [];
		const run = runWhenIdle(
			[1, 2, 3, 4].map(() => () => {
				order.push('task');
			}),
			{
				batchSize: 2,
				isBusy: () => false,
				sleep: () => {
					order.push('yield');

					return Promise.resolve();
				}
			}
		);
		await run.done;

		// One yield per batch: two batches of two.
		expect(order.filter((entry) => entry === 'yield').length).toBe(2);
	});
});

describe('prioritiseByDependencies', () => {
	const files = ['/app/a.vue', '/app/b.vue', '/app/c.vue', '/app/d.vue'];
	const dependencies = new Map<string, Set<string>>([
		['/app/c.vue', new Set(['/app/d.vue'])]
	]);

	test('puts entry sources and their transitive imports first', () => {
		expect(
			prioritiseByDependencies(files, ['/app/c.vue'], dependencies)
		).toEqual(['/app/c.vue', '/app/d.vue', '/app/a.vue', '/app/b.vue']);
	});

	test('keeps the original order when nothing has been built yet', () => {
		expect(prioritiseByDependencies(files, [], dependencies)).toEqual(
			files
		);
	});

	test('ignores entry sources and dependencies outside the file set', () => {
		expect(
			prioritiseByDependencies(
				files,
				['/other/page.vue'],
				new Map([['/other/page.vue', new Set(['/other/dep.vue'])]])
			)
		).toEqual(files);
	});

	test('survives an import cycle', () => {
		const cyclic = new Map<string, Set<string>>([
			['/app/a.vue', new Set(['/app/b.vue'])],
			['/app/b.vue', new Set(['/app/a.vue'])]
		]);

		expect(prioritiseByDependencies(files, ['/app/a.vue'], cyclic)).toEqual(
			['/app/a.vue', '/app/b.vue', '/app/c.vue', '/app/d.vue']
		);
	});
});

describe('dependencyOrderedSequence', () => {
	test('re-prioritises when a page is built mid-run', () => {
		const files = ['/app/a.vue', '/app/b.vue', '/app/c.vue', '/app/d.vue'];
		const built: string[] = [];
		const sequence = dependencyOrderedSequence(
			files,
			() => built,
			() => new Map([['/app/c.vue', new Set(['/app/d.vue'])]])
		);

		const seen: string[] = [];
		for (const file of sequence) {
			seen.push(file);
			// After the first file, a request builds page c.
			if (seen.length === 1) built.push('/app/c.vue');
		}

		expect(seen[0]).toBe('/app/a.vue');
		expect(seen.slice(1, 3)).toEqual(['/app/c.vue', '/app/d.vue']);
		expect(seen).toHaveLength(4);
		expect(new Set(seen).size).toBe(4);
	});

	test('yields every file exactly once with no entries', () => {
		const files = ['/app/a.vue', '/app/b.vue'];

		expect([
			...dependencyOrderedSequence(
				files,
				() => [],
				() => new Map()
			)
		]).toEqual(files);
	});
});
