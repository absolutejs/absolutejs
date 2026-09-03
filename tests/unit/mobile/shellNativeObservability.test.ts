import { describe, expect, mock, test } from 'bun:test';
import {
	drainAbsoluteMobileNativeObservability,
	type AbsoluteMobileNativeObservabilityPlugin
} from '../../../src/mobile/shellNativeObservability';
import type { AbsoluteMobileClientManifest } from '../../../src/mobile/transport';

const manifest: AbsoluteMobileClientManifest = {
	appBuild: 'ambuild_123',
	appId: 'com.example.product',
	appName: 'Product',
	deepLinkHosts: [],
	deviceCapabilities: [],
	entry: '/',
	format: 1,
	nativeRuntime: 'a'.repeat(64),
	observability: {
		endpoint: 'https://api.example.com/api/observability/errors',
		environment: 'production',
		project: 'project-1',
		sampleRate: 1
	},
	pages: [],
	productionOrigin: 'https://api.example.com',
	routes: [],
	runtime: '4'
};

describe('native observability drain', () => {
	test('redacts and acknowledges bounded native reports only after accepted delivery', async () => {
		const acknowledged: string[][] = [];
		const plugin: AbsoluteMobileNativeObservabilityPlugin = {
			acknowledge: mock(async ({ ids }) => {
				acknowledged.push(ids);
			}),
			pending: mock(async () => ({
				reports: [
					{
						details: {
							description: 'crashed token=hunter2',
							secret: 'do-not-send',
							status: 11
						},
						id: 'android:123:5:11',
						kind: 'native-crash',
						occurredAt: 1_700_000_000_000,
						platform: 'android'
					}
				]
			}))
		};
		let envelope: Record<string, unknown> | undefined;
		const fetch = mock(async (_input, init) => {
			envelope = JSON.parse(String(init?.body));

			return new Response(null, { status: 202 });
		});

		expect(
			await drainAbsoluteMobileNativeObservability(manifest, fetch, {
				native: true,
				plugin
			})
		).toBe(1);
		expect(acknowledged).toEqual([['android:123:5:11']]);
		expect(envelope).toMatchObject({
			environment: 'production',
			project: 'project-1',
			release: 'ambuild_123',
			v: 1
		});
		const serialized = JSON.stringify(envelope);
		expect(serialized).toContain('crashed token=[REDACTED]');
		expect(serialized).not.toContain('hunter2');
		expect(serialized).not.toContain('do-not-send');
	});

	test('retains reports when the trusted relay rejects delivery', async () => {
		const acknowledge = mock(async () => undefined);
		const plugin: AbsoluteMobileNativeObservabilityPlugin = {
			acknowledge,
			pending: async () => ({
				reports: [
					{
						details: { reason: 6 },
						id: 'android:124:6:0',
						kind: 'anr',
						occurredAt: 1_700_000_000_001,
						platform: 'android'
					}
				]
			})
		};

		expect(
			await drainAbsoluteMobileNativeObservability(
				manifest,
				async () => new Response(null, { status: 503 }),
				{ native: true, plugin }
			)
		).toBe(0);
		expect(acknowledge).not.toHaveBeenCalled();
	});
});
