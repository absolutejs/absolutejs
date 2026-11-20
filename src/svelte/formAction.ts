import type {
	ActionFieldErrors,
	ActionFormValues,
	ActionIdleState,
	ActionResult,
	ActionState,
	FormActionBindingOptions,
	SvelteFormActionValue
} from '../../types/formAction';
import { submitFormAction } from '../client/formActions';
import {
	isActionState,
	optimisticValue,
	shownActionData
} from '../utils/formActionProtocol';

const IDLE: ActionIdleState = { status: 'idle' };

/* The button that submitted the form, so its own name and value reach the
 * server and a form with two buttons can say which was pressed. Only when
 * the form actually owns it: `requestSubmit()` and a detached control can
 * both leave `submitter` pointing elsewhere, and `FormData` throws on a
 * submitter the form does not own. */
const submitterOf = (event: SubmitEvent, form: HTMLFormElement) => {
	const { submitter } = event;
	if (!(submitter instanceof HTMLElement)) return null;
	const owner = Reflect.get(submitter, 'form');

	return owner === form ? submitter : null;
};

/* A store written by hand rather than `writable` from `svelte/store`, for
 * the same reason as islandStore.ts: this module is imported while a page
 * renders on the server, and nothing here needs Svelte's runtime. The
 * contract is the one `$store` expects — subscribe calls back immediately
 * and hands back an unsubscriber. */
const createFormActionStore = <Value>(initial: Value) => {
	let current = initial;
	const listeners = new Set<(next: Value) => void>();

	return {
		set(next: Value) {
			current = next;
			for (const listener of listeners) listener(current);
		},
		subscribe(listener: (next: Value) => void) {
			listener(current);
			listeners.add(listener);

			return () => {
				listeners.delete(listener);
			};
		}
	};
};

/**
 * Progressive-enhancement form state for a `form` route, as a store:
 *
 *   <script lang="ts">
 *   	import { formAction } from '@absolutejs/absolute/svelte';
 *
 *   	let { signupState } = $props();
 *   	const signup = formAction('/users', { initialState: signupState });
 *   	let name = $state(signupState?.values?.name ?? '');
 *   </script>
 *
 *   <form {...signup.formProps} use:signup.enhance>
 *   	<input name="name" bind:value={name} />
 *   	{#if $signup.errors.name}<p>{$signup.errors.name}</p>{/if}
 *   	<button disabled={$signup.pending}>Save</button>
 *   </form>
 *
 * `formProps` renders a real `method="post"` form, so it submits without
 * JavaScript and before hydration; `use:signup.enhance` takes the
 * submission over once hydrated and `$signup` updates in place.
 *
 * `initialState` is what a submission without JavaScript left behind:
 * `getActionState(path)` in the route, handed to the page as a prop.
 *
 * `$signup.values` refills the form after a submission WITHOUT JavaScript
 * failed, and is empty otherwise. Seed component state from it and bind
 * that, as above, rather than writing it straight into the attribute:
 * `value={…}` is re-applied on every re-render, so showing an error would
 * wipe what the user had just typed, and `defaultValue` is not rendered
 * server-side, which loses the no-JS refill.
 */
export const formAction = <Data = unknown, Fields extends string = string>(
	path: string,
	options: FormActionBindingOptions<Data> = {}
) => {
	const resetOnSuccess = options.resetOnSuccess !== false;
	const restored = options.initialState;
	let state: ActionState<Data, Fields> =
		restored && isActionState<Data, Fields>(restored) ? restored : IDLE;
	let pending = false;
	let optimistic: { value: Data } | undefined;
	let controller: AbortController | undefined;

	const snapshot = (): SvelteFormActionValue<Data, Fields> => {
		const errors: ActionFieldErrors<Fields> =
			state.status === 'error' ? state.errors : {};
		const values: ActionFormValues<Fields> =
			state.status === 'error' ? (state.values ?? {}) : {};

		return {
			data: shownActionData(state, optimistic),
			errors,
			message: state.status === 'error' ? state.message : undefined,
			pending,
			state,
			values
		};
	};

	const store = createFormActionStore(snapshot());
	const publish = () => store.set(snapshot());

	/** Adopt a result, unless a newer submission has already replaced
	 *  this one — then its result is the one the form should show. */
	const adopt = (
		result: ActionResult<Data, Fields>,
		own: AbortController
	) => {
		if (controller !== own) return result;
		state = result;
		if (result.status === 'success' && result.redirect) {
			window.location.assign(result.redirect);
		}

		return result;
	};

	const settle = (own: AbortController) => {
		if (controller !== own) return;
		pending = false;
		optimistic = undefined;
		publish();
	};

	const submit = async (body: FormData) => {
		// Before aborting the previous submission: the caller's mapper may
		// throw, and then nothing should have been disturbed.
		const provisional = optimisticValue(options.optimistic, body);
		controller?.abort();
		const own = new AbortController();
		controller = own;
		pending = true;
		optimistic = provisional;
		publish();
		try {
			return adopt(
				await submitFormAction<Data, Fields>(path, body, {
					signal: own.signal
				}),
				own
			);
		} finally {
			settle(own);
		}
	};

	const clearOnSuccess = (form: HTMLFormElement, result: ActionResult) => {
		if (result.status !== 'success' || result.redirect || !resetOnSuccess) {
			return;
		}
		form.reset();
	};

	/** Svelte action: `use:signup.enhance` on the `<form>`. */
	const enhance = (form: HTMLFormElement) => {
		const listener = (event: SubmitEvent) => {
			event.preventDefault();
			const body = new FormData(form, submitterOf(event, form));
			submit(body)
				.then((result) => clearOnSuccess(form, result))
				// An aborted submission is not an error: a newer one
				// replaced it.
				.catch(() => undefined);
		};
		form.addEventListener('submit', listener);

		return {
			destroy() {
				controller?.abort();
				form.removeEventListener('submit', listener);
			}
		};
	};

	const reset = () => {
		state = IDLE;
		optimistic = undefined;
		publish();
	};

	return {
		enhance,
		formProps: {
			action: path,
			enctype: 'multipart/form-data',
			method: 'post'
		},
		reset,
		submit,
		subscribe: store.subscribe
	};
};
