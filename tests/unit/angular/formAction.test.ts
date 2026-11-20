import { afterEach, describe, expect, test } from 'bun:test';
import type { ActionResult } from '../../../types/formAction';
import { useFormAction } from '../../../src/angular/composables/useFormAction';

type Fields = 'email';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const answerWith = (result: ActionResult<{ id: number }, Fields>) => {
	const stub = () =>
		Promise.resolve(
			new Response(JSON.stringify(result), {
				headers: { 'content-type': 'application/json' }
			})
		);
	globalThis.fetch = Object.assign(stub, {
		preconnect: originalFetch.preconnect
	});
};

describe('Angular useFormAction', () => {
	// No `inject()` anywhere in the factory, so no TestBed and no injection
	// context: the signals can be read directly. The directive owns what
	// does need injection (ElementRef, DestroyRef).
	test('starts idle', () => {
		const signup = useFormAction<{ id: number }, Fields>('/signup');

		expect(signup.state().status).toBe('idle');
		expect(signup.pending()).toBe(false);
		expect(signup.errors()).toEqual({});
		expect(signup.values()).toEqual({});
		expect(signup.data()).toBeUndefined();
		expect(signup.message()).toBeUndefined();
	});

	test('carries the path for the form attribute, and the reset preference', () => {
		expect(useFormAction('/signup').path).toBe('/signup');
		expect(useFormAction('/signup').resetOnSuccess).toBe(true);
		expect(
			useFormAction('/signup', { resetOnSuccess: false }).resetOnSuccess
		).toBe(false);
	});

	test('restores the state a submission without JavaScript left behind', () => {
		const signup = useFormAction<{ id: number }, Fields>('/signup', {
			initialState: {
				errors: { email: 'Already registered' },
				message: 'Check the form',
				status: 'error',
				values: { email: 'ada@example.com' }
			}
		});

		expect(signup.errors().email).toBe('Already registered');
		expect(signup.values().email).toBe('ada@example.com');
		expect(signup.message()).toBe('Check the form');
	});

	test('ignores an initialState that is not an action state', () => {
		// The result arrives through a cookie, which can hold anything.
		const signup = useFormAction<{ id: number }, Fields>('/signup', {
			initialState: { nonsense: true } as never
		});

		expect(signup.state().status).toBe('idle');
	});

	test('submit flips pending and publishes the result', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const signup = useFormAction<{ id: number }, Fields>('/signup');

		const promise = signup.submit(new FormData());
		expect(signup.pending()).toBe(true);
		const result = await promise;

		expect(result.status).toBe('success');
		expect(signup.pending()).toBe(false);
		expect(signup.data()).toEqual({ id: 7 });
		expect(signup.errors()).toEqual({});
	});

	test('field errors and values reach the signals', async () => {
		answerWith({
			errors: { email: 'Already registered' },
			message: 'Check the form',
			status: 'error',
			values: { email: 'ada@example.com' }
		});
		const signup = useFormAction<{ id: number }, Fields>('/signup');

		await signup.submit(new FormData());

		expect(signup.errors().email).toBe('Already registered');
		expect(signup.message()).toBe('Check the form');
		expect(signup.values().email).toBe('ada@example.com');
		expect(signup.data()).toBeUndefined();
	});

	test('reset returns the form to idle', async () => {
		answerWith({ errors: { email: 'No' }, status: 'error' });
		const signup = useFormAction<{ id: number }, Fields>('/signup');
		await signup.submit(new FormData());
		expect(signup.state().status).toBe('error');

		signup.reset();

		expect(signup.state().status).toBe('idle');
		expect(signup.errors()).toEqual({});
	});

	test('a superseded submission does not overwrite the newer result', async () => {
		answerWith({ errors: { email: 'first' }, status: 'error' });
		const signup = useFormAction<{ id: number }, Fields>('/signup');

		const first = signup.submit(new FormData());
		answerWith({ data: { id: 2 }, status: 'success' });
		const second = signup.submit(new FormData());
		await Promise.all([first, second]);

		// The second submission owns the state, and pending is settled by it.
		expect(signup.state().status).toBe('success');
		expect(signup.data()).toEqual({ id: 2 });
		expect(signup.pending()).toBe(false);
	});

	test('abort discards the submission and settles pending', async () => {
		answerWith({ data: { id: 1 }, status: 'success' });
		const signup = useFormAction<{ id: number }, Fields>('/signup');

		const inFlight = signup.submit(new FormData());
		signup.abort();
		await inFlight.catch(() => undefined);

		// A response that arrives after an abort belongs to nobody: the
		// form was given up on, so it must not show a result.
		expect(signup.state().status).toBe('idle');
		expect(signup.pending()).toBe(false);
	});
});

describe('Angular useFormAction and optimistic data', () => {
	test('an optimistic value is data until the real one lands', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const signup = useFormAction<{ id: number }, Fields>('/signup', {
			optimistic: (body) => ({ id: Number(body.get('id')) })
		});
		const body = new FormData();
		body.set('id', '1');

		const promise = signup.submit(body);
		// Provisional, with pending saying so.
		expect(signup.data()).toEqual({ id: 1 });
		expect(signup.pending()).toBe(true);
		await promise;

		expect(signup.data()).toEqual({ id: 7 });
		expect(signup.pending()).toBe(false);
	});

	test('a failed submission clears the optimistic value', async () => {
		answerWith({ errors: { email: 'No' }, status: 'error' });
		const signup = useFormAction<{ id: number }, Fields>('/signup', {
			optimistic: () => ({ id: 1 })
		});

		await signup.submit(new FormData());

		expect(signup.data()).toBeUndefined();
		expect(signup.errors().email).toBe('No');
	});

	test('abort drops the optimistic value with the submission', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const signup = useFormAction<{ id: number }, Fields>('/signup', {
			optimistic: () => ({ id: 1 })
		});

		const promise = signup.submit(new FormData());
		expect(signup.data()).toEqual({ id: 1 });
		signup.abort();

		// Nothing is in flight any more, so there is nothing for a
		// provisional value to be provisional about.
		expect(signup.data()).toBeUndefined();
		expect(signup.pending()).toBe(false);
		await promise;
	});
});
