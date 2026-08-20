import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
	absoluteHmrClientTarget,
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
			serverMs: 18,
			updateId: 123
		});
		const [call] = send.mock.calls;
		expect(call).toBeDefined();
		const payload = JSON.parse(String(call?.[0]));
		expect(payload.target).toBe('capacitor-android');
		expect(payload.serverMs).toBe(18);
		expect(payload.duration).toBeGreaterThanOrEqual(18);
		expect(payload.updateId).toBe(123);
		expect(payload).not.toHaveProperty('appId');
		expect(payload).not.toHaveProperty('path');
	});
});
