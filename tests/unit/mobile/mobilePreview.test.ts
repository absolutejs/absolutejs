import { describe, expect, test } from 'bun:test';
import {
	ABSOLUTE_MOBILE_PREVIEW_PATH,
	absoluteMobilePreviewDocument,
	createAbsoluteMobilePreviewPlugin
} from '../../../src/mobile/mobilePreview';
import type { MobileConfig } from '../../../types/build';

const mobile = {
	appId: 'com.example.preview',
	appName: 'Preview <App>',
	entry: '/account?tab=profile',
	platforms: ['ios', 'android'],
	server: { productionOrigin: 'https://app.example' }
} satisfies MobileConfig;

describe('mobile preview', () => {
	test('renders an isolated first-class runtime controller', () => {
		const html = absoluteMobilePreviewDocument(mobile);

		expect(html).toContain('Preview &lt;App&gt;');
		expect(html).toContain('__absolute_target');
		expect(html).toContain('mobile-preview');
		expect(html).toContain('absolute-preview:lifecycle');
		expect(html).toContain('absolute-preview:network');
		expect(html).toContain('absolute-preview:permission');
		expect(html).toContain('absolute-preview:deep-link');
		expect(html).toContain('title="Preview &lt;App&gt; mobile runtime"');
		expect(html).not.toContain('sandbox=');
		expect(html).not.toContain('https://app.example');
	});

	test('mounts preview resources only for mobile-enabled development', async () => {
		const disabled = createAbsoluteMobilePreviewPlugin(undefined);
		const disabledResponse = await disabled.handle(
			new Request(`http://localhost${ABSOLUTE_MOBILE_PREVIEW_PATH}`)
		);
		expect(disabledResponse.status).toBe(404);

		const app = createAbsoluteMobilePreviewPlugin(mobile);
		const response = await app.handle(
			new Request(`http://localhost${ABSOLUTE_MOBILE_PREVIEW_PATH}`)
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		expect(await response.text()).toContain(
			'AbsoluteJS mobile runtime preview'
		);
	});

	test('rejects invalid preview telemetry', async () => {
		const app = createAbsoluteMobilePreviewPlugin(mobile);
		const invalidTelemetry = await app.handle(
			new Request(
				'http://localhost/__absolute/mobile-preview-telemetry',
				{
					body: JSON.stringify({ durationMs: -1, platform: 'ios' }),
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				}
			)
		);
		expect(invalidTelemetry.status).toBe(400);
	});
});
