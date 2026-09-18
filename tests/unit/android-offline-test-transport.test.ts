import { expect, test } from 'bun:test';
import { disconnectAndroidTestBackend } from '../helpers/androidOffline';

test('offline acceptance removes the listener and closes existing streams only on the selected device', async () => {
	const commands: string[][] = [];
	await disconnectAndroidTestBackend(async (...args) => {
		commands.push(args);

		return '';
	});
	expect(commands).toEqual([
		['reverse', '--remove', 'tcp:48443'],
		['reconnect'],
		['wait-for-device']
	]);
});

test('offline acceptance stops if its reverse listener cannot be removed', async () => {
	let calls = 0;
	await expect(
		disconnectAndroidTestBackend(async () => {
			calls++;
			throw new Error('not owned');
		})
	).rejects.toThrow('not owned');
	expect(calls).toBe(1);
});
