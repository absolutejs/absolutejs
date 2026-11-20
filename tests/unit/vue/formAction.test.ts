import { resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { effectScope } from 'vue';
import type { ActionResult } from '../../../types/formAction';
import { useFormAction } from '../../../src/vue/useFormAction';

type Fields = 'email';

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const answerWith = (result: ActionResult<{ id: number }, Fields>) => {
	// `preconnect` is carried over so the stub still satisfies `typeof
	// fetch` without an assertion.
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

/** The composable registers `onScopeDispose`, so give it a scope. */
const inScope = <Value>(body: () => Value) => {
	const scope = effectScope();
	const value = scope.run(body);
	if (value === undefined) throw new Error('scope did not run');

	return { value, stop: () => scope.stop() };
};

describe('Vue useFormAction', () => {
	test('starts idle', () => {
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup')
		);

		expect(signup.state.value.status).toBe('idle');
		expect(signup.pending.value).toBe(false);
		expect(signup.errors.value).toEqual({});
		expect(signup.values.value).toEqual({});
		expect(signup.data.value).toBeUndefined();
		stop();
	});

	test('restores the state a submission without JavaScript left behind', () => {
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup', {
				initialState: {
					errors: { email: 'Already registered' },
					status: 'error',
					values: { email: 'ada@example.com' }
				}
			})
		);

		expect(signup.errors.value.email).toBe('Already registered');
		expect(signup.values.value.email).toBe('ada@example.com');
		stop();
	});

	test('ignores an initialState that is not an action state', () => {
		const { stop, value: signup } = inScope(() =>
			// The result arrives through a cookie, which can hold anything.
			useFormAction<{ id: number }, Fields>('/signup', {
				initialState: { nonsense: true } as never
			})
		);

		expect(signup.state.value.status).toBe('idle');
		stop();
	});

	test('formProps carry the action, the method and the listener', () => {
		const { stop, value: signup } = inScope(() => useFormAction('/signup'));

		expect(signup.formProps.action).toBe('/signup');
		expect(signup.formProps.method).toBe('post');
		expect(signup.formProps.enctype).toBe('multipart/form-data');
		expect(typeof signup.formProps.onSubmit).toBe('function');
		stop();
	});

	test('submit flips pending and publishes the result', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup')
		);

		const promise = signup.submit(new FormData());
		expect(signup.pending.value).toBe(true);
		const result = await promise;

		expect(result.status).toBe('success');
		expect(signup.pending.value).toBe(false);
		expect(signup.data.value).toEqual({ id: 7 });
		stop();
	});

	test('an optimistic value is data until the real one lands', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup', {
				optimistic: (body) => ({ id: Number(body.get('id')) })
			})
		);
		const body = new FormData();
		body.set('id', '1');

		const promise = signup.submit(body);
		// Provisional, with pending saying so.
		expect(signup.data.value).toEqual({ id: 1 });
		expect(signup.pending.value).toBe(true);
		await promise;

		expect(signup.data.value).toEqual({ id: 7 });
		expect(signup.pending.value).toBe(false);
		stop();
	});

	test('a failed submission clears the optimistic value', async () => {
		answerWith({ errors: { email: 'No' }, status: 'error' });
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup', {
				optimistic: () => ({ id: 1 })
			})
		);

		await signup.submit(new FormData());

		// Otherwise the form would show a success that never happened,
		// next to the error explaining why it did not.
		expect(signup.data.value).toBeUndefined();
		expect(signup.errors.value.email).toBe('No');
		stop();
	});

	test('a mapper that throws is reported, and the submission goes on', async () => {
		answerWith({ data: { id: 7 }, status: 'success' });
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup', {
				optimistic: () => {
					throw new Error('bad mapper');
				}
			})
		);
		const logged: unknown[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => logged.push(args[0]);

		try {
			const result = await signup.submit(new FormData());
			// The mapper decorates the wait; the form still had work to do.
			expect(result.status).toBe('success');
			expect(signup.data.value).toEqual({ id: 7 });
		} finally {
			console.error = original;
		}
		// And not silent: the binding's own submit handler swallows
		// rejections to ignore aborted submissions, so an exception left
		// to propagate would vanish and look like a form that never
		// updates.
		expect(logged).toHaveLength(1);
		expect(String(logged[0])).toContain('`optimistic` mapper threw');
		stop();
	});

	test('field errors, message and values reach the refs', async () => {
		answerWith({
			errors: { email: 'Already registered' },
			message: 'Check the form',
			status: 'error',
			values: { email: 'ada@example.com' }
		});
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup')
		);

		await signup.submit(new FormData());

		expect(signup.errors.value.email).toBe('Already registered');
		expect(signup.message.value).toBe('Check the form');
		expect(signup.values.value.email).toBe('ada@example.com');
		expect(signup.data.value).toBeUndefined();
		stop();
	});

	test('reset returns the form to idle', async () => {
		answerWith({ errors: { email: 'No' }, status: 'error' });
		const { stop, value: signup } = inScope(() =>
			useFormAction<{ id: number }, Fields>('/signup')
		);
		await signup.submit(new FormData());

		signup.reset();

		expect(signup.state.value.status).toBe('idle');
		expect(signup.errors.value).toEqual({});
		stop();
	});
});

describe('Vue useFormAction in a mounted page', () => {
	test('submits the form, renders the result, and keeps what the user typed after an error', async () => {
		// A clean process: Vue's runtime-dom captures `document` on first
		// evaluation, and the whole suite may have imported Vue for SSR
		// before happy-dom was installed.
		const runner = resolve(
			import.meta.dir,
			'../../fixtures/vue-form-action/runtime.ts'
		);
		const subprocess = Bun.spawn([process.execPath, runner], {
			stderr: 'pipe',
			stdout: 'pipe'
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stdout).text(),
			new Response(subprocess.stderr).text()
		]);

		expect(stderr).toBe('');
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			// The field is a ref bound with v-model, so the re-render that
			// shows the error cannot wipe it.
			errorState: {
				error: 'Already registered',
				kept: 'ada@example.com',
				pending: false
			},
			restoredState: {
				error: 'Already registered',
				seeded: 'ada@example.com'
			},
			successState: {
				body: { email: 'ada@example.com' },
				welcome: '1'
			}
		});
	}, 60_000);
});
