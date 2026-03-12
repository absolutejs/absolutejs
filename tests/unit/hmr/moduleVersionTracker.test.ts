import { describe, expect, test } from 'bun:test';
import {
	createModuleVersionTracker,
	incrementModuleVersion,
	incrementModuleVersions,
	serializeModuleVersions
} from '../../../src/dev/moduleVersionTracker';

describe('moduleVersionTracker', () => {
	test('creates empty tracker', () => {
		const tracker = createModuleVersionTracker();
		expect(tracker.size).toBe(0);
	});

	test('incrementModuleVersion sets version and returns it', () => {
		const tracker = createModuleVersionTracker();
		const v1 = incrementModuleVersion(tracker, '/react/Page.tsx');
		expect(v1).toBeGreaterThan(0);
		expect(tracker.get('/react/Page.tsx')).toBe(v1);
	});

	test('incrementModuleVersion increments on subsequent calls', () => {
		const tracker = createModuleVersionTracker();
		const v1 = incrementModuleVersion(tracker, '/react/Page.tsx');
		const v2 = incrementModuleVersion(tracker, '/react/Page.tsx');
		expect(v2).toBeGreaterThan(v1);
	});

	test('different modules get different versions', () => {
		const tracker = createModuleVersionTracker();
		const v1 = incrementModuleVersion(tracker, '/a.tsx');
		const v2 = incrementModuleVersion(tracker, '/b.tsx');
		expect(v1).not.toBe(v2);
	});

	test('incrementModuleVersions updates multiple at once', () => {
		const tracker = createModuleVersionTracker();
		const updated = incrementModuleVersions(tracker, ['/a.tsx', '/b.tsx']);
		expect(updated.size).toBe(2);
		expect(tracker.size).toBe(2);
		expect(tracker.has('/a.tsx')).toBe(true);
		expect(tracker.has('/b.tsx')).toBe(true);
	});

	test('serializeModuleVersions converts to plain object', () => {
		const tracker = createModuleVersionTracker();
		incrementModuleVersion(tracker, '/a.tsx');
		incrementModuleVersion(tracker, '/b.tsx');
		const serialized = serializeModuleVersions(tracker);
		expect(typeof serialized).toBe('object');
		expect(typeof serialized['/a.tsx']).toBe('number');
		expect(typeof serialized['/b.tsx']).toBe('number');
	});

	test('serializeModuleVersions returns empty object for empty tracker', () => {
		const tracker = createModuleVersionTracker();
		const serialized = serializeModuleVersions(tracker);
		expect(serialized).toEqual({});
	});
});
