import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	getCurrentAbsoluteRequest,
	runWithAbsoluteRequest
} from '../../../src/core/requestContext';
import {
	registerStreamingSlot,
	setStreamingSlotRegistrar
} from '../../../src/core/streamingSlotRegistrar';
import type { StreamingSlot } from '../../../src/utils/streamingSlots';

/* The registrar is process-wide; other suites install their own, so the
 * one in place before each test is put back after it. */
const REGISTRAR_KEY = Symbol.for('absolutejs.streamingSlotRegistrar');
let previous: unknown;
beforeEach(() => {
	previous = Reflect.get(globalThis, REGISTRAR_KEY);
});
afterEach(() => {
	Reflect.set(globalThis, REGISTRAR_KEY, previous);
});

describe('a streaming slot resolves in its request', () => {
	test('code a slot calls sees the request it was rendered for', async () => {
		const registered: StreamingSlot[] = [];
		setStreamingSlotRegistrar((slot) => registered.push(slot));
		const request = new Request('http://localhost/portal', {
			headers: { cookie: 'session=visitor' }
		});

		runWithAbsoluteRequest(request, () =>
			registerStreamingSlot({
				id: 'slot',
				resolve: async () =>
					getCurrentAbsoluteRequest()?.headers.get('cookie') ?? 'none'
			})
		);

		/* Resolved later, outside the request, as the response streams. */
		expect(getCurrentAbsoluteRequest()).toBeUndefined();
		expect(await registered[0]?.resolve()).toBe('session=visitor');
	});

	test('a slot registered outside a request is left as it was', () => {
		const registered: StreamingSlot[] = [];
		setStreamingSlotRegistrar((slot) => registered.push(slot));
		const resolve = () => 'html';
		registerStreamingSlot({ id: 'slot', resolve });

		expect(registered[0]?.resolve).toBe(resolve);
	});
});
