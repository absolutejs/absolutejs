// Runs in a clean Bun process: Vue's runtime-dom captures `document` when
// it is first evaluated, so happy-dom must be registered before the first
// `import('vue')`. The test spawns this file and asserts on the JSON it
// prints. See tests/unit/vue/formAction.test.ts.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ActionResult, ActionState } from '../../../types/formAction';

GlobalRegistrator.register({ url: 'http://localhost:3000/signup' });

type Data = { id: number };
type Fields = 'email';
type Body = Record<string, string>;
type SuccessReport = { body: Body | null; welcome: string | null };
type ErrorReport = { error: string | null; kept: string; pending: boolean };
type RestoredReport = { error: string | null; seeded: string };
type Harness = { pending: boolean; submit: () => void; typed: () => string };
type Mounted = {
	app: { unmount: () => void };
	harness: Harness;
	host: HTMLElement;
};

const bodies: Body[] = [];
let answer: ActionResult<Data, Fields> = { data: { id: 1 }, status: 'success' };

const recordBody = (body: FormData) => {
	const entries = Array.from(body.entries()).map(
		([key, value]) => [key, String(value)] as const
	);
	bodies.push(Object.fromEntries(entries));
};

const fakeFetch = (_input: string | URL | Request, init?: RequestInit) => {
	const body = init?.body;
	if (body instanceof FormData) recordBody(body);

	return Promise.resolve(
		new Response(JSON.stringify(answer), {
			headers: { 'content-type': 'application/json' }
		})
	);
};
globalThis.fetch = Object.assign(fakeFetch, {
	preconnect: globalThis.fetch.preconnect
});

const { createApp, h, ref } = await import('vue');
const { useFormAction } = await import('../../../src/vue/useFormAction');

/** Mount a page that uses the composable the way a real one would: the
 *  field in a ref seeded from `values`, bound through an input listener. */
const mountSignup = (initialState: ActionState<Data, Fields> | null) => {
	const host = document.createElement('div');
	document.body.append(host);
	let harness: Harness | undefined;
	const app = createApp({
		setup() {
			const signup = useFormAction<Data, Fields>('/signup', {
				initialState
			});
			const email = ref(String(signup.values.value.email ?? ''));
			const onInput = (event: Event) => {
				const { target } = event;
				if (!(target instanceof HTMLInputElement)) return;
				email.value = target.value;
			};
			harness = {
				get pending() {
					return signup.pending.value;
				},
				submit: () => host.querySelector('form')?.requestSubmit(),
				typed: () => email.value
			};

			return () =>
				h('form', signup.formProps, [
					h('input', { name: 'email', onInput, value: email.value }),
					signup.errors.value.email
						? h(
								'p',
								{ id: 'email-error' },
								signup.errors.value.email
							)
						: null,
					signup.data.value
						? h(
								'p',
								{ id: 'welcome' },
								String(signup.data.value.id)
							)
						: null
				]);
		}
	});
	app.mount(host);
	if (!harness) throw new Error('setup never ran');
	const mounted: Mounted = { app, harness, host };

	return mounted;
};

const settle = () => Bun.sleep(5);

const type = (mounted: Mounted, value: string) => {
	const input = mounted.host.querySelector('input');
	if (!input) throw new Error('no input');
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
};

const text = (mounted: Mounted, selector: string) =>
	mounted.host.querySelector(selector)?.textContent ?? null;

// 1. A success: the result reaches the template.
const success = mountSignup(null);
type(success, 'ada@example.com');
success.harness.submit();
await settle();
const successState: SuccessReport = {
	body: bodies[0] ?? null,
	welcome: text(success, '#welcome')
};
success.app.unmount();

// 2. An error: the message renders and what the user typed survives, which
//    is the whole reason the field lives in a ref rather than in :value.
answer = { errors: { email: 'Already registered' }, status: 'error' };
const failure = mountSignup(null);
type(failure, 'ada@example.com');
failure.harness.submit();
await settle();
const errorState: ErrorReport = {
	error: text(failure, '#email-error'),
	kept: failure.harness.typed(),
	pending: failure.harness.pending
};
failure.app.unmount();

// 3. The state a submission without JavaScript left behind seeds the form.
const restored = mountSignup({
	errors: { email: 'Already registered' },
	status: 'error',
	values: { email: 'ada@example.com' }
});
const restoredState: RestoredReport = {
	error: text(restored, '#email-error'),
	seeded: restored.harness.typed()
};
restored.app.unmount();

console.log(JSON.stringify({ errorState, restoredState, successState }));
