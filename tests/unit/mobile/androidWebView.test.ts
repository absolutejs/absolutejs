import { describe, expect, test } from 'bun:test';
import { parseAndroidWebViewDevtoolsSockets } from '../../../src/mobile/androidWebView';

describe('Android WebView debugger discovery', () => {
	test('prefers the socket owned by the application process', () => {
		const sockets = parseAndroidWebViewDevtoolsSockets(
			`0000000000000000: 00000002 00000000 00010000 0001 01 123 @webview_devtools_remote_812
0000000000000000: 00000002 00000000 00010000 0001 01 124 @webview_devtools_remote_924
0000000000000000: 00000002 00000000 00010000 0001 01 125 @com.example.product_devtools_remote`,
			{ appId: 'com.example.product', pids: ['924'] }
		);

		expect(sockets).toEqual([
			'webview_devtools_remote_924',
			'com.example.product_devtools_remote'
		]);
	});

	test('deduplicates sockets and excludes unrelated fallbacks', () => {
		const sockets = parseAndroidWebViewDevtoolsSockets(
			`@webview_devtools_remote_41
@webview_devtools_remote_41
@other_devtools_remote`,
			{ appId: 'com.example.product', pids: ['41', '42'] }
		);

		expect(sockets).toEqual(['webview_devtools_remote_41']);
	});
});
