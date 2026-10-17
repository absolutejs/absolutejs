import { describe, expect, test } from 'bun:test';
import {
	type ServerSnapshot,
	RECONNECT_GIVE_UP_MS,
	missedWhileDisconnected,
	reconnectDelayMs
} from '../../../src/dev/client/reconnect';

describe('dev client reconnect', () => {
	test('backs off from half a second to ten, for half an hour', () => {
		expect([0, 1, 2, 4, 5, 12].map(reconnectDelayMs)).toEqual([
			500, 1_000, 2_000, 8_000, 10_000, 10_000
		]);
		expect(RECONNECT_GIVE_UP_MS).toBe(30 * 60_000);
	});

	test('a first connection has nothing to have missed', () => {
		expect(
			missedWhileDisconnected(
				undefined,
				{ lastBroadcastAt: 99, serverStartedAt: 1 },
				0
			)
		).toBe(false);
	});

	test('the same server with no newer update keeps the page', () => {
		const snapshot: ServerSnapshot = {
			lastBroadcastAt: 500,
			serverStartedAt: 1
		};
		expect(missedWhileDisconnected(snapshot, snapshot, 500)).toBe(false);
	});

	test('an update sent while away, or a restarted server, reloads', () => {
		const before: ServerSnapshot = {
			lastBroadcastAt: 500,
			serverStartedAt: 1
		};
		expect(
			missedWhileDisconnected(
				before,
				{ lastBroadcastAt: 900, serverStartedAt: 1 },
				500
			)
		).toBe(true);
		expect(
			missedWhileDisconnected(
				before,
				{ lastBroadcastAt: 0, serverStartedAt: 2 },
				500
			)
		).toBe(true);
	});

	test('a server that does not say when it started counts as restarted', () => {
		expect(missedWhileDisconnected({}, {}, 0)).toBe(true);
	});
});
