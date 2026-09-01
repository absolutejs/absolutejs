import { afterEach, describe, expect, test } from 'bun:test';
import { getDeviceAdapter } from '@absolutejs/devices/runtime';
import {
	createAbsoluteExpoBridgeFetch,
	installAbsoluteExpoWebDeviceAdapter
} from '../../../src/mobile/shellExpoDevices';

const removals: (() => void)[] = [];

afterEach(() => {
	removals
		.splice(0)
		.reverse()
		.forEach((remove) => remove());
	Reflect.deleteProperty(globalThis, '__absoluteExpoBridge');
});

describe('Expo embedded-web providers', () => {
	test('routes provider-neutral haptics through the native bridge', async () => {
		const requests: unknown[][] = [];
		Reflect.set(globalThis, '__absoluteExpoBridge', {
			request: async (...args: unknown[]) => requests.push(args)
		});
		removals.push(installAbsoluteExpoWebDeviceAdapter(['haptics']));

		const { haptics } = getDeviceAdapter();
		if (!haptics) throw new TypeError('Expected the haptics capability.');
		await haptics.impact('medium');

		expect(getDeviceAdapter().runtime).toBe('expo');
		expect(requests).toEqual([
			['devices.haptics.impact', { style: 'medium' }]
		]);
	});

	test('reconstructs a standard Response from native GET transport', async () => {
		Reflect.set(globalThis, '__absoluteExpoBridge', {
			request: async () => ({
				body: '{"ok":true}',
				headers: { 'content-type': 'application/json' },
				status: 200
			})
		});
		const fetch = createAbsoluteExpoBridgeFetch();
		const response = await fetch('https://api.example.com/account', {
			headers: { accept: 'application/json' }
		});

		expect(await response.json()).toEqual({ ok: true });
		expect(response.headers.get('content-type')).toBe('application/json');
	});

	test('does not silently fall back when the native bridge is absent', async () => {
		expect(() => installAbsoluteExpoWebDeviceAdapter(['haptics'])).toThrow(
			'bridge is unavailable'
		);
	});
});
