import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ActionResult } from '../../../types/formAction';

/* The hook's own state transitions, which the integration suite cannot
 * isolate and the server renderer cannot see at all: `optimistic` is about
 * what `data` holds between the click and the answer.
 *
 * This file registers a DOM and mounts React, so it runs in its own
 * process — `scripts/unitTests.ts` lists it. Sharing one with
 * `link.test.tsx` took that test's document away and left its router
 * update uncommitted.
 *
 * No `act()` either. React keeps its act queue in module state; using it
 * left that queue dirty for whatever ran next. Awaiting a macrotask
 * flushes React's work just as well for these assertions and leaves
 * nothing behind. */

type Data = { id: number };
type Fields = 'email';

type Probe = {
	data: Data | undefined;
	pending: boolean;
	submit: (body: FormData) => Promise<ActionResult<Data, Fields>>;
};

type Harness = {
	mount: (optimistic?: (body: FormData) => Data) => Promise<void>;
	unmount: () => Promise<void>;
};

const seen: Probe = {
	data: undefined,
	pending: false,
	submit: () => {
		throw new Error('not mounted');
	}
};

let harness: Harness | undefined;

const originalFetch = globalThis.fetch;

/* A macrotask: enough for React to commit, and for a resolved fetch to
 * travel through the hook's promise chain. */
const settled = () => Bun.sleep(0);

/* A submission that only answers when the test says so, which is how the
 * provisional value can be observed at all. */
const gatedAnswer = (result: ActionResult<Data, Fields>) => {
	let open: () => void = () => {
		throw new Error('gate never opened');
	};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const stub = () =>
		gate.then(
			() =>
				new Response(JSON.stringify(result), {
					headers: { 'content-type': 'application/json' }
				})
		);
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});

	return { open };
};

beforeAll(async () => {
	GlobalRegistrator.register({ url: 'http://localhost:3000/signup' });
	const { createElement } = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { useFormAction } =
		await import('../../../src/react/hooks/useFormAction');
	const container = document.createElement('div');
	document.body.append(container);
	const root = createRoot(container);
	const Component = ({
		optimistic
	}: {
		optimistic?: (body: FormData) => Data;
	}) => {
		const action = useFormAction<Data, Fields>('/signup', { optimistic });
		seen.data = action.data;
		seen.pending = action.pending;
		seen.submit = action.submit;

		return null;
	};
	harness = {
		mount: async (optimistic) => {
			root.render(createElement(Component, { optimistic }));
			await settled();
		},
		unmount: async () => {
			root.unmount();
			await settled();
		}
	};
});

afterAll(async () => {
	globalThis.fetch = originalFetch;
	await harness?.unmount();
	GlobalRegistrator.unregister();
});

const harnessOf = () => {
	if (!harness) throw new Error('react harness never loaded');

	return harness;
};

test('an optimistic value is data until the real one lands', async () => {
	const { mount } = harnessOf();
	const { open } = gatedAnswer({ data: { id: 7 }, status: 'success' });
	await mount((body) => ({ id: Number(body.get('id')) }));
	const body = new FormData();
	body.set('id', '1');

	const submission = seen.submit(body);
	await settled();
	// Provisional, with pending saying so.
	expect(seen.data).toEqual({ id: 1 });
	expect(seen.pending).toBe(true);

	open();
	await submission;
	await settled();
	expect(seen.data).toEqual({ id: 7 });
	expect(seen.pending).toBe(false);
});

test('a failed submission clears the optimistic value', async () => {
	const { mount } = harnessOf();
	const { open } = gatedAnswer({ errors: { email: 'No' }, status: 'error' });
	await mount(() => ({ id: 1 }));

	const submission = seen.submit(new FormData());
	await settled();
	expect(seen.data).toEqual({ id: 1 });

	open();
	await submission;
	await settled();
	// Otherwise the form would show a success that never happened, next to
	// the error explaining why it did not.
	expect(seen.data).toBeUndefined();
});

test('a mapper that throws is reported, and the submission goes on', async () => {
	const { mount } = harnessOf();
	const { open } = gatedAnswer({ data: { id: 7 }, status: 'success' });
	await mount(() => {
		throw new Error('bad mapper');
	});
	const logged: unknown[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => logged.push(args[0]);

	try {
		const submission = seen.submit(new FormData());
		await settled();
		open();
		await submission;
		await settled();
	} finally {
		console.error = original;
	}

	expect(seen.data).toEqual({ id: 7 });
	expect(
		logged.filter((line) =>
			String(line).includes('`optimistic` mapper threw')
		)
	).toHaveLength(1);
});
