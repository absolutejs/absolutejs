import { describe, expect, test } from 'bun:test';
import { startWorkspaceOrShutDown } from '../../../src/cli/scripts/workspace';

const recorder = () => {
	const calls: number[] = [];

	return {
		calls,
		shutdown: (exitCode: number) => {
			calls.push(exitCode);
		}
	};
};

describe('startWorkspaceOrShutDown', () => {
	test('starts cleanly and shuts nothing down', async () => {
		const { calls, shutdown } = recorder();
		const started = await startWorkspaceOrShutDown({
			shutdown,
			onFailure: () => undefined,
			start: () => Promise.resolve()
		});

		expect(started).toBe(true);
		expect(calls).toEqual([]);
	});

	test('tears down the services it already started when one never becomes ready', async () => {
		// The bug this pins: a readiness timeout used to reject out of the
		// whole command while the children it had already spawned kept
		// running — an orphaned server holding the port with no supervisor.
		const { calls, shutdown } = recorder();
		const started = await startWorkspaceOrShutDown({
			shutdown,
			onFailure: () => undefined,
			start: () =>
				Promise.reject(
					new Error('service did not become ready within 120000ms')
				)
		});

		expect(started).toBe(false);
		expect(calls).toEqual([1]);
	});

	test('reports why startup failed before tearing down', async () => {
		const messages: string[] = [];
		await startWorkspaceOrShutDown({
			onFailure: (message) => messages.push(message),
			shutdown: () => undefined,
			start: () => Promise.reject(new Error('port 3000 already in use'))
		});

		expect(messages).toEqual(['port 3000 already in use']);
	});

	test('a non-Error rejection still reports something usable', async () => {
		const messages: string[] = [];
		const { calls, shutdown } = recorder();
		await startWorkspaceOrShutDown({
			shutdown,
			onFailure: (message) => messages.push(message),
			start: () => Promise.reject('spawn failed')
		});

		expect(messages).toEqual(['spawn failed']);
		expect(calls).toEqual([1]);
	});

	test('waits for shutdown to finish before reporting failure', async () => {
		// Teardown is asynchronous — killing processes and running shutdown
		// hooks. Returning before it settles would race the exit.
		const order: string[] = [];
		await startWorkspaceOrShutDown({
			onFailure: () => undefined,
			shutdown: async () => {
				await Promise.resolve();
				order.push('shutdown');
			},
			start: () => Promise.reject(new Error('nope'))
		});
		order.push('returned');

		expect(order).toEqual(['shutdown', 'returned']);
	});
});
