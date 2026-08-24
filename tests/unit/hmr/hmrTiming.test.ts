import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	absoluteHmrClientTarget,
	restoreAbsoluteHmrApply,
	sendAbsoluteHmrTiming
} from '../../../src/dev/client/hmrTiming';

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'Capacitor');
	Reflect.deleteProperty(globalThis, 'location');
	Reflect.deleteProperty(globalThis, 'window');
});

describe('HMR client timing', () => {
	test('distinguishes web and native Capacitor targets', () => {
		expect(absoluteHmrClientTarget()).toBe('web');
		Reflect.set(globalThis, 'Capacitor', {
			getPlatform: () => 'android',
			isNativePlatform: () => true
		});
		expect(absoluteHmrClientTarget()).toBe('capacitor-android');
	});

	test('prefers the deterministic native transport marker', () => {
		Reflect.set(globalThis, 'location', {
			search: '?__absolute_target=capacitor-ios'
		});
		expect(absoluteHmrClientTarget()).toBe('capacitor-ios');
	});

	test('reports target and server/client timing without application identity', () => {
		Reflect.set(globalThis, 'Capacitor', {
			getPlatform: () => 'android',
			isNativePlatform: () => true
		});
		const send = mock((_value: string) => undefined);
		Reflect.set(globalThis, 'window', { __HMR_WS__: { send } });
		sendAbsoluteHmrTiming({
			clientStart: performance.now(),
			kind: 'html',
			serverMs: 18,
			updateId: 123
		});
		const [call] = send.mock.calls;
		expect(call).toBeDefined();
		const payload = JSON.parse(String(call?.[0]));
		expect(payload.target).toBe('capacitor-android');
		expect(payload.serverMs).toBe(18);
		expect(payload.kind).toBe('html');
		expect(payload.outcome).toBe('applied');
		expect(payload.duration).toBeGreaterThanOrEqual(18);
		expect(payload.updateId).toBe(123);
		expect(payload).not.toHaveProperty('appId');
		expect(payload).not.toHaveProperty('path');
		expect((globalThis.window as Window).__ABS_HMR_LAST_APPLY__).toEqual({
			clientMs: payload.clientMs,
			duration: payload.duration,
			kind: 'html',
			outcome: 'applied',
			serverMs: 18,
			target: 'capacitor-android',
			updateId: 123
		});
		const applies = (globalThis.window as Window).__ABS_HMR_APPLIES__;
		expect(applies).toHaveLength(1);
		expect(applies?.[0]).toEqual(
			(globalThis.window as Window).__ABS_HMR_LAST_APPLY__
		);
	});

	test('records an apply for deterministic automation without a websocket', () => {
		Reflect.set(globalThis, 'window', {});
		sendAbsoluteHmrTiming({
			clientStart: performance.now(),
			kind: 'css',
			updateId: 456
		});
		expect(
			(globalThis.window as Window).__ABS_HMR_LAST_APPLY__
		).toMatchObject({
			kind: 'css',
			outcome: 'applied',
			target: 'web',
			updateId: 456
		});
	});

	test('retains a bounded history so overlapping applies remain observable', () => {
		Reflect.set(globalThis, 'window', {});
		for (let updateId = 1; updateId <= 55; updateId += 1) {
			sendAbsoluteHmrTiming({ clientStart: performance.now(), updateId });
		}
		const applies = (globalThis.window as Window).__ABS_HMR_APPLIES__ ?? [];
		expect(applies).toHaveLength(50);
		expect(applies[0]?.updateId).toBe(6);
		expect(applies.at(-1)?.updateId).toBe(55);
	});

	test('restores bounded apply history after a same-tab fallback reload', () => {
		const values = new Map<string, string>();
		const sessionStorage: Pick<Storage, 'getItem' | 'setItem'> = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		};
		Reflect.set(globalThis, 'window', { sessionStorage });
		sendAbsoluteHmrTiming({
			clientStart: performance.now(),
			kind: 'component',
			outcome: 'reloaded',
			updateId: 789
		});
		sendAbsoluteHmrTiming({
			clientStart: performance.now(),
			kind: 'css',
			outcome: 'failed',
			updateId: 790
		});
		Reflect.set(globalThis, 'window', { sessionStorage });
		restoreAbsoluteHmrApply();
		expect(
			(globalThis.window as Window).__ABS_HMR_LAST_APPLY__
		).toMatchObject({
			kind: 'css',
			outcome: 'failed',
			updateId: 790
		});
		expect((globalThis.window as Window).__ABS_HMR_APPLIES__).toMatchObject(
			[
				{ kind: 'component', outcome: 'reloaded', updateId: 789 },
				{ kind: 'css', outcome: 'failed', updateId: 790 }
			]
		);
	});

	test('restores the legacy single-apply storage representation', () => {
		const timing: NonNullable<Window['__ABS_HMR_LAST_APPLY__']> = {
			clientMs: 2,
			duration: 5,
			kind: 'html',
			outcome: 'applied',
			serverMs: 3,
			target: 'web',
			updateId: 791
		};
		const sessionStorage: Pick<Storage, 'getItem' | 'setItem'> = {
			getItem: () => JSON.stringify(timing),
			setItem: () => undefined
		};
		Reflect.set(globalThis, 'window', { sessionStorage });
		restoreAbsoluteHmrApply();
		expect((globalThis.window as Window).__ABS_HMR_APPLIES__).toEqual([
			timing
		]);
	});
});
