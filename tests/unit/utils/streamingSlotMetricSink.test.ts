import { describe, expect, test } from 'bun:test';
import { createStreamingSlotMetricSink } from '../../../src/utils/streamingSlotMetricSink';

describe('streamingSlotMetricSink', () => {
	test('includes route and metadata and emits reported metrics', () => {
		const captured: Array<{
			slotId: string;
			at: number;
			route?: string;
			type: string;
			metadata?: Record<string, unknown>;
		}> = [];
		const handler = createStreamingSlotMetricSink({
			metadata: { enabled: true, section: 'home' },
			route: '/dashboard',
			onReport: (metric) => {
				captured.push(metric);
			}
		});

		handler({
			bytes: 20,
			durationMs: 12,
			slotId: 'a',
			type: 'resolved'
		});
		const [metric] = captured;

		expect(captured).toHaveLength(1);
		expect(metric).toBeDefined();
		if (!metric) {
			throw new Error('Expected captured metric');
		}

		expect(metric.slotId).toBe('a');
		expect(metric.route).toBe('/dashboard');
		expect(metric.metadata).toEqual({
			enabled: true,
			section: 'home'
		});
		expect(metric.at).toBeGreaterThan(0);
		expect(metric.type).toBe('resolved');
	});

	test('filters by includeTypes and excludeTypes', () => {
		const captured: string[] = [];
		const handler = createStreamingSlotMetricSink({
			excludeTypes: ['patched'],
			includeTypes: ['prepared', 'patched'],
			onReport: (metric) => {
				captured.push(metric.type);
			}
		});

		handler({ slotId: 'a', type: 'prepared' });
		handler({ slotId: 'a', type: 'patched' });
		handler({ slotId: 'a', type: 'resolved' });

		expect(captured).toEqual(['prepared']);
	});

	test('skips all events when sampleRate is 0', () => {
		let captured = 0;
		const handler = createStreamingSlotMetricSink({
			sampleRate: 0,
			onReport: () => {
				captured += 1;
			}
		});

		for (let i = 0; i < 20; i += 1) {
			handler({ slotId: 'sample', type: 'resolved' });
		}

		expect(captured).toBe(0);
	});

	test('reports async transport errors to onError', async () => {
		let errorSeen = false;
		const handler = createStreamingSlotMetricSink({
			onError: () => {
				errorSeen = true;
			},
			onReport: () => Promise.reject(new Error('network failed'))
		});

		handler({ slotId: 'a', type: 'resolved' });

		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(errorSeen).toBe(true);
	});

	test('no-op when no onReport is provided', () => {
		const handler = createStreamingSlotMetricSink();
		expect(() => {
			handler({
				slotId: 'a',
				type: 'prepared'
			});
		}).not.toThrow();
	});
});
