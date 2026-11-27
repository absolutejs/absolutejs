import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import type {
	ActionFieldErrors,
	ActionFormValues,
	ActionIdleState,
	ActionResult,
	ActionState,
	FormActionBindingOptions
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
 * the form actually owns it: a detached control and `requestSubmit()` can
 * both leave `submitter` pointing elsewhere, and `FormData` throws on a
 * submitter the form does not own. */
const submitterOf = (event: SubmitEvent, form: HTMLFormElement) => {
	const { submitter } = event;
	if (!(submitter instanceof HTMLElement)) return null;
	const owner = Reflect.get(submitter, 'form');

	return owner === form ? submitter : null;
};

/**
 * Progressive-enhancement form state for a `form` route:
 *
 *   <script setup lang="ts">
 *   	import { useFormAction } from '@absolutejs/absolute/vue';
 *
 *   	const props = defineProps<{ signupState: ActionState | null }>();
 *   	const signup = useFormAction('/users', {
 *   		initialState: props.signupState
 *   	});
 *   	const name = ref(signup.values.value.name ?? '');
 *   </script>
 *
 *   <template>
 *   	<form v-bind="signup.formProps">
 *   		<input name="name" v-model="name" />
 *   		<p v-if="signup.errors.value.name">{{ signup.errors.value.name }}</p>
 *   		<button :disabled="signup.pending.value">Save</button>
 *   	</form>
 *   </template>
 *
 * `formProps` carries a real `action`, `method="post"` and the submit
 * listener, so the form posts without JavaScript and before hydration,
 * and the listener takes over once hydrated.
 *
 * `initialState` is what a submission without JavaScript left behind:
 * `getActionState(path)` in the route, handed to the page as a prop.
 *
 * `values` refills the form after a submission WITHOUT JavaScript failed,
 * and is empty otherwise. Seed a `ref` from it and `v-model` that, as
 * above, rather than binding `values` straight to `:value`: a bound
 * `:value` is re-applied on every re-render, so the re-render that shows
 * an error would wipe whatever the user had just typed.
 */
export const useFormAction = <Data = unknown, Fields extends string = string>(
	path: string,
	options: FormActionBindingOptions<Data> = {}
) => {
	const restored = options.initialState;
	const resetOnSuccess = options.resetOnSuccess !== false;
	// `shallowRef`, not `ref`: the whole state object is replaced on each
	// result, and it types as the union exactly, where `ref` would need a
	// cast past its deep-unwrap type.
	const state = shallowRef<ActionState<Data, Fields>>(
		restored && isActionState<Data, Fields>(restored) ? restored : IDLE
	);
	const pending = ref(false);
	// Wrapped, so a provisional `undefined` is still distinguishable from
	// "no submission in flight".
	const optimistic = shallowRef<{ value: Data } | undefined>(undefined);
	let controller: AbortController | undefined;

	onScopeDispose(() => controller?.abort());

	/** Adopt a result, unless a newer submission already replaced this
	 *  one — then its result is the one the form should show. */
	const adopt = (
		result: ActionResult<Data, Fields>,
		own: AbortController
	) => {
		if (controller !== own) return result;
		state.value = result;
		if (result.status === 'success' && result.redirect) {
			window.location.assign(result.redirect);
		}

		return result;
	};

	const settle = (own: AbortController) => {
		if (controller !== own) return;
		pending.value = false;
		optimistic.value = undefined;
	};

	const submit = async (body: FormData) => {
		// Before aborting the previous submission: the caller's mapper may
		// throw, and then nothing should have been disturbed.
		const provisional = optimisticValue(options.optimistic, body);
		controller?.abort();
		const own = new AbortController();
		controller = own;
		pending.value = true;
		optimistic.value = provisional;
		try {
			return adopt(
				await submitFormAction<Data, Fields>(path, body, {
					invalidate: options.invalidate,
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

	const onSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		const form = event.currentTarget;
		if (!(form instanceof HTMLFormElement)) return;
		const body = new FormData(form, submitterOf(event, form));
		submit(body)
			.then((result) => clearOnSuccess(form, result))
			// An aborted submission is not an error: a newer one replaced it.
			.catch(() => undefined);
	};

	const reset = () => {
		state.value = IDLE;
		optimistic.value = undefined;
	};

	return {
		data: computed(() => shownActionData(state.value, optimistic.value)),
		// Annotated: without it the empty-object branch widens the type
		// and `errors.value.email` stops type-checking for the caller.
		errors: computed<ActionFieldErrors<Fields>>(() =>
			state.value.status === 'error' ? state.value.errors : {}
		),
		formProps: {
			action: path,
			enctype: 'multipart/form-data',
			method: 'post',
			onSubmit
		},
		message: computed(() =>
			state.value.status === 'error' ? state.value.message : undefined
		),
		pending,
		reset,
		state,
		submit,
		values: computed<ActionFormValues<Fields>>(() =>
			state.value.status === 'error' ? (state.value.values ?? {}) : {}
		)
	};
};
