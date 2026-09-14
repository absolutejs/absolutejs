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
		expect(
			absoluteAndroidDevelopmentUrl(3029, '/react', false, 'expo-android')
		).toBe('http://localhost:3029/react?__absolute_target=expo-android');
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

	test('can navigate through the page so a controlled native WebView observes it', async () => {
		const waitFor: AbsoluteAndroidWebViewSession['waitFor'] = async <T>() =>
			({
				bodyText: 'AbsoluteJS + React',
				hmrConnected: true,
				nativeTarget: 'expo-android',
				overlayVisible: false,
				title: 'React',
				url: 'http://localhost:3029/react?__absolute_target=expo-android'
			}) as T;
		const session = fakeSession(waitFor);
		const evaluate = mock(async () => undefined as never);
		session.evaluate = evaluate;

		await inspectAbsoluteAndroidRoute(session, {
			navigation: 'in-page',
			port: 3029,
			route: '/react',
			target: 'expo-android'
		});

		expect(evaluate).toHaveBeenCalledWith(
			'location.assign("http://localhost:3029/react?__absolute_target=expo-android")'
		);
	});

	test('can inspect a route already opened by the native router', async () => {
		const expressions: string[] = [];
		const waitFor: AbsoluteAndroidWebViewSession['waitFor'] = async <T>(
			expression: string
		) => {
			expressions.push(expression);

			return {
				bodyText: 'AbsoluteJS + HTML',
				hmrConnected: true,
				nativeTarget: 'expo-android',
				overlayVisible: false,
				title: 'HTML',
				url: 'http://localhost:3029/html?__absolute_target=expo-android'
			} as T;
		};
		const session = fakeSession(waitFor);
		const navigate = mock(async () => undefined);
		session.navigate = navigate;

		await inspectAbsoluteAndroidRoute(session, {
			navigation: 'none',
			port: 3029,
			route: '/html',
			target: 'expo-android'
		});

		expect(navigate).not.toHaveBeenCalled();
		expect(expressions[0]).toContain(
			'new URL(value.url).pathname === "/html"'
		);
		expect(expressions[0]).toContain(
			'new URL(value.url).origin === "http://localhost:3029"'
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
