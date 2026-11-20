import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type {
	ActionResult,
	SvelteFormActionValue
} from '../../../types/formAction';

beforeAll(() =>
	GlobalRegistrator.register({ url: 'http://localhost:3000/signup' })
);
afterAll(() => GlobalRegistrator.unregister());

const { formAction } = await import('../../../src/svelte/formAction');

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	document.body.innerHTML = '';
});

type Fields = 'email';

/** Answer every action post with one result, and record the bodies. */
const answerWith = (result: ActionResult<{ id: number }, Fields>) => {
	const bodies: FormData[] = [];
	globalThis.fetch = (async (_url: string, init?: RequestInit) => {
		if (init?.body instanceof FormData) bodies.push(init.body);

		return new Response(JSON.stringify(result), {
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;

	return bodies;
};

const read = (
	action: ReturnType<typeof formAction<{ id: number }, Fields>>
) => {
	let value: SvelteFormActionValue<{ id: number }, Fields> | undefined;
	const unsubscribe = action.subscribe((next) => {
		value = next;
	});
	unsubscribe();
	if (!value) throw new Error('store never published');

	return value;
};

const formWith = (markup: string) => {
	document.body.innerHTML = markup;
	const form = document.querySelector('form');
	if (!form) throw new Error('no form');

	return form;
};

test('starts idle, and publishes to a subscriber immediately', () => {
	const action = formAction<{ id: number }, Fields>('/signup');
	const seen: SvelteFormActionValue<{ id: number }, Fields>[] = [];
	const unsubscribe = action.subscribe((next) => seen.push(next));

	expect(seen).toHaveLength(1);
	expect(seen[0]?.state.status).toBe('idle');
	expect(seen[0]?.pending).toBe(false);
	expect(seen[0]?.errors).toEqual({});
	expect(seen[0]?.values).toEqual({});
	unsubscribe();
});

test('restores the state a submission without JavaScript left behind', () => {
	const action = formAction<{ id: number }, Fields>('/signup', {
		initialState: {
			errors: { email: 'Already registered' },
			status: 'error',
			values: { email: 'ada@example.com' }
		}
	});

	const value = read(action);
	expect(value.errors.email).toBe('Already registered');
	expect(value.values.email).toBe('ada@example.com');
	expect(value.message).toBeUndefined();
});

test('ignores an initialState that is not an action state', () => {
	const action = formAction<{ id: number }, Fields>('/signup', {
		// A cookie can hold anything; the binding must not trust it.
		initialState: { nonsense: true } as never
	});

	expect(read(action).state.status).toBe('idle');
});

test('formProps render a real post form', () => {
	const action = formAction('/signup');

	expect(action.formProps).toEqual({
		action: '/signup',
		enctype: 'multipart/form-data',
		method: 'post'
	});
});

test('submit publishes pending, then the result', async () => {
	answerWith({ data: { id: 7 }, status: 'success' });
	const action = formAction<{ id: number }, Fields>('/signup');
	const seen: boolean[] = [];
	const unsubscribe = action.subscribe((next) => seen.push(next.pending));

	const result = await action.submit(new FormData());

	expect(result.status).toBe('success');
	expect(seen).toEqual([false, true, false]);
	expect(read(action).data).toEqual({ id: 7 });
	unsubscribe();
});

test('field errors and typed values reach the store', async () => {
	answerWith({
		errors: { email: 'Already registered' },
		message: 'Check the form',
		status: 'error',
		values: { email: 'ada@example.com' }
	});
	const action = formAction<{ id: number }, Fields>('/signup');

	await action.submit(new FormData());

	const value = read(action);
	expect(value.errors.email).toBe('Already registered');
	expect(value.message).toBe('Check the form');
	expect(value.values.email).toBe('ada@example.com');
	expect(value.data).toBeUndefined();
});

test('reset returns the form to idle', async () => {
	answerWith({ errors: { email: 'No' }, status: 'error' });
	const action = formAction<{ id: number }, Fields>('/signup');
	await action.submit(new FormData());
	expect(read(action).state.status).toBe('error');

	action.reset();

	expect(read(action).state.status).toBe('idle');
	expect(read(action).errors).toEqual({});
});

test('enhance submits the form and includes the submitter', async () => {
	const bodies = answerWith({ data: { id: 1 }, status: 'success' });
	const action = formAction<{ id: number }, Fields>('/signup');
	const form = formWith(
		`<form><input name="email" value="ada@example.com" /><button name="intent" value="save">Save</button></form>`
	);
	const handle = action.enhance(form);

	const button = document.querySelector('button');
	button?.click();
	await Bun.sleep(5);

	expect(bodies).toHaveLength(1);
	expect(bodies[0]?.get('email')).toBe('ada@example.com');
	// The submitter's own name/value belongs in the body, so a form with
	// two buttons can tell the server which one was pressed.
	expect(bodies[0]?.get('intent')).toBe('save');
	expect(read(action).state.status).toBe('success');
	handle.destroy();
});

test('enhance resets the form after a success, and leaves it after an error', async () => {
	answerWith({ data: { id: 1 }, status: 'success' });
	const action = formAction<{ id: number }, Fields>('/signup');
	// Typed by the user, not set as a default: `form.reset()` restores
	// defaults, so a `value` attribute would survive the reset.
	const form = formWith(`<form><input name="email" /></form>`);
	const typed = document.querySelector('input');
	if (typed) typed.value = 'ada@example.com';
	const handle = action.enhance(form);

	form.requestSubmit();
	await Bun.sleep(5);

	expect(new FormData(form).get('email')).toBe('');
	handle.destroy();
});

test('enhance leaves what the user typed after an error', async () => {
	answerWith({ errors: { email: 'Already registered' }, status: 'error' });
	const action = formAction<{ id: number }, Fields>('/signup');
	const form = formWith(`<form><input name="email" /></form>`);
	const typed = document.querySelector('input');
	if (typed) typed.value = 'ada@example.com';
	const handle = action.enhance(form);

	form.requestSubmit();
	await Bun.sleep(5);

	expect(new FormData(form).get('email')).toBe('ada@example.com');
	expect(read(action).errors.email).toBe('Already registered');
	handle.destroy();
});

test('resetOnSuccess false keeps what the user typed', async () => {
	answerWith({ data: { id: 1 }, status: 'success' });
	const action = formAction<{ id: number }, Fields>('/signup', {
		resetOnSuccess: false
	});
	const form = formWith(`<form><input name="email" /></form>`);
	const typed = document.querySelector('input');
	if (typed) typed.value = 'ada@example.com';
	const handle = action.enhance(form);

	form.requestSubmit();
	await Bun.sleep(5);

	expect(new FormData(form).get('email')).toBe('ada@example.com');
	handle.destroy();
});

test('destroy stops the listener, so the form posts normally again', async () => {
	const bodies = answerWith({ data: { id: 1 }, status: 'success' });
	const action = formAction<{ id: number }, Fields>('/signup');
	const form = formWith(`<form><input name="email" value="a@b.c" /></form>`);

	action.enhance(form).destroy();
	form.requestSubmit();
	await Bun.sleep(5);

	expect(bodies).toHaveLength(0);
});
