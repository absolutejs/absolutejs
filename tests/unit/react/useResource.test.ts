import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { UseResourceResult } from '../../../src/react/hooks/useResource';

/* The hook mounted for real: that it loads on mount and not before,
 * that a render sees each change, and that unmounting stops the load.
 *
 * Registers a DOM and mounts React, so it runs in its own process —
 * `scripts/unitTests.ts` lists it, for the reasons in
 * useFormAction.test.ts. No `act()` either, for the same ones. */

type Harness = {
	mount: () => Promise<void>;
	unmount: () => Promise<void>;
};

let harness: Harness | undefined;
let latest: UseResourceResult<string> | undefined;
const renders: boolean[] = [];
const signals: AbortSignal[] = [];
let answer: (value: string) => void = () => undefined;

/* Long enough for React to commit AND run the mount effect, which it
 * schedules after the commit: one macrotask is not always both. */
const settled = () => Bun.sleep(20);

beforeAll(async () => {
	GlobalRegistrator.register({ url: 'http://localhost:3000/' });
	const { createElement } = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { useResource } =
		await import('../../../src/react/hooks/useResource');
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	const Component = () => {
		latest = useResource(
			(signal) =>
				new Promise<string>((resolve) => {
					signals.push(signal);
					answer = resolve;
				})
		);
		renders.push(latest.loading);

		return null;
	};
	harness = {
		mount: async () => {
			root.render(createElement(Component));
			await settled();
		},
		unmount: async () => {
			root.unmount();
			await settled();
		}
	};
});

afterAll(async () => {
	await harness?.unmount();
	GlobalRegistrator.unregister();
});

test('loads on mount, and a render sees the value arrive', async () => {
	await harness?.mount();

	expect(signals).toHaveLength(1);
	expect(latest?.loading).toBe(true);
	expect(latest?.data).toBeNull();

	answer('loaded');
	await settled();

	expect(latest?.loading).toBe(false);
	expect(latest?.data).toBe('loaded');
	// It rendered while loading, and again once loaded.
	expect(renders[0]).toBe(true);
	expect(renders.at(-1)).toBe(false);
});

test('mutate and refresh reach the component', async () => {
	latest?.mutate('edited');
	await settled();
	expect(latest?.data).toBe('edited');

	void latest?.refresh();
	await settled();
	expect(latest?.loading).toBe(true);
	expect(signals).toHaveLength(2);

	answer('again');
	await settled();
	expect(latest?.data).toBe('again');
});

test('unmounting stops a load in flight', async () => {
	void latest?.refresh();
	await settled();
	const inFlight = signals.at(-1);
	expect(inFlight?.aborted).toBe(false);

	await harness?.unmount();

	expect(inFlight?.aborted).toBe(true);
});
