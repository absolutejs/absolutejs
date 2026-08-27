import { describe, expect, mock, test } from 'bun:test';
import {
	absoluteAndroidDevelopmentUrl,
	inspectAbsoluteAndroidRoute,
	waitForAbsoluteAndroidHmrApply
} from '../../../src/mobile/androidConformance';
import type { AbsoluteAndroidWebViewSession } from '../../../src/mobile/androidWebView';

const fakeSession = (
	waitFor: AbsoluteAndroidWebViewSession['waitFor']
): AbsoluteAndroidWebViewSession => ({
	diagnostics: [],
	hostPort: 9222,
	serial: 'emulator-5554',
	socket: 'webview_devtools_remote_41',
	target: { type: 'page', url: 'http://localhost:3000/react' },
	waitFor,
	close: async () => undefined,
	evaluate: async () => undefined as never,
	navigate: async () => undefined,
	screenshot: async (path) => path,
	tap: async () => undefined
});

describe('Android native conformance', () => {
	test('builds a loopback route with a deterministic native target', () => {
		expect(absoluteAndroidDevelopmentUrl(3029, '/react?tab=one')).toBe(
			'http://localhost:3029/react?tab=one&__absolute_target=capacitor-android'
		);
		expect(() => absoluteAndroidDevelopmentUrl(3029, 'react')).toThrow(
			'absolute application paths'
		);
	});

	test('verifies route content, target, socket, and overlay state', async () => {
		const waitFor: AbsoluteAndroidWebViewSession['waitFor'] = async <T>() =>
			({
				bodyText: 'AbsoluteJS + React',
				hmrConnected: true,
				nativeTarget: 'capacitor-android',
				overlayVisible: false,
				title: 'React',
				url: 'http://localhost:3029/react?__absolute_target=capacitor-android'
			}) as T;
		const session = fakeSession(waitFor);
		const navigate = mock(async () => undefined);
		session.navigate = navigate;

		const result = await inspectAbsoluteAndroidRoute(session, {
			port: 3029,
			route: '/react'
		});

		expect(result.nativeTarget).toBe('capacitor-android');
		expect(navigate).toHaveBeenCalledWith(
			'http://localhost:3029/react?__absolute_target=capacitor-android'
		);
	});

	test('waits for a newer matching native apply acknowledgement', async () => {
		const expressions: string[] = [];
		const waitFor: AbsoluteAndroidWebViewSession['waitFor'] = async <T>(
			expression: string
		) => {
			expressions.push(expression);

			return {
				clientMs: 11,
				duration: 28,
				kind: 'component' as const,
				outcome: 'applied' as const,
				serverMs: 17,
				target: 'capacitor-android' as const,
				updateId: 42
			} as T;
		};
		const apply = await waitForAbsoluteAndroidHmrApply(
			fakeSession(waitFor),
			{ afterUpdateId: 41, kind: 'component' }
		);

		expect(apply.updateId).toBe(42);
		expect(expressions[0]).toContain('value.updateId > 41');
	});
});
