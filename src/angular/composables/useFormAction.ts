import { computed, signal, type Signal } from '@angular/core';
import type {
	ActionFieldErrors,
	ActionFormValues,
	ActionIdleState,
	ActionResult,
	ActionState,
	FormActionBindingOptions
} from '../../../types/formAction';
import { submitFormAction } from '../../client/formActions';
import {
	isActionState,
	optimisticValue,
	shownActionData
} from '../../utils/formActionProtocol';

const IDLE: ActionIdleState = { status: 'idle' };

export type FormAction<Data = unknown, Fields extends string = string> = {
	/** The handler's return value, after a successful submission. */
	data: Signal<Data | undefined>;
	errors: Signal<ActionFieldErrors<Fields>>;
	/** A message for the whole form, when the action set one. */
	message: Signal<string | undefined>;
	pending: Signal<boolean>;
	state: Signal<ActionState<Data, Fields>>;
	/** What the user typed, after a submission without JavaScript failed. */
	values: Signal<ActionFormValues<Fields>>;
	/** The action's URL, for the form's own `action` attribute. */
	path: string;
	/** Post a body and adopt the result. `[absoluteAction]` calls this on
	 *  submit; call it directly to submit a form you built yourself. */
	submit: (body: FormData) => Promise<ActionResult<Data, Fields>>;
	/** Back to idle, clearing errors and values. */
	reset: () => void;
	/** Abort an in-flight submission. `[absoluteAction]` calls this when
	 *  the form is destroyed. */
	abort: () => void;
	/** Whether `[absoluteAction]` clears the form after a success that
	 *  does not redirect. Set through the options; read by the directive. */
	resetOnSuccess: boolean;
};

/**
 * Progressive-enhancement form state for a `form` route, as signals:
 *
 *   @Component({
 *   	imports: [AbsoluteActionDirective],
 *   	template: `
 *   		<form [absoluteAction]="signup">
 *   			<input name="name" [value]="typedName()" (input)="type($event)" />
 *   			@if (signup.errors()['name']) {
 *   				<p>{{ signup.errors()['name'] }}</p>
 *   			}
 *   			<button [disabled]="signup.pending()">Save</button>
 *   		</form>
 *   	`
 *   })
 *   export class SignupPage {
 *   	readonly signup = useFormAction('/users', {
 *   		initialState: this.props.signupState
 *   	});
 *   }
 *
 * `[absoluteAction]` writes the real `action`, `method="post"` and
 * `enctype` onto the form, so it posts without JavaScript and before
 * hydration, and takes the submission over once hydrated.
 *
 * `initialState` is what a submission without JavaScript left behind:
 * `getActionState(path)` in the route, handed to the page as a prop.
 *
 * `values()` refills the form after a submission WITHOUT JavaScript
 * failed, and is empty otherwise. Seed a signal from it and bind that,
 * rather than binding `values()` straight to `[value]`: a bound `[value]`
 * is re-applied on every change detection, so the pass that renders an
 * error would wipe whatever the user had just typed.
 *
 * Unlike `useResource`, this does not call `inject()`, so it can be
 * created outside an injection context — in a test, or in a plain class.
 * The directive owns the DOM listener and aborts on destroy.
 */
export const useFormAction = <Data = unknown, Fields extends string = string>(
	path: string,
	options: FormActionBindingOptions<Data> = {}
): FormAction<Data, Fields> => {
	const restored = options.initialState;
	const resetOnSuccess = options.resetOnSuccess !== false;
	const state = signal<ActionState<Data, Fields>>(
		restored && isActionState<Data, Fields>(restored) ? restored : IDLE
	);
	const pending = signal(false);
	// Wrapped, so a provisional `undefined` is still distinguishable from
	// "no submission in flight".
	const optimistic = signal<{ value: Data } | undefined>(undefined);
	let controller: AbortController | undefined;

	/** Adopt a result, unless a newer submission already replaced this
	 *  one — then its result is the one the form should show. */
	const adopt = (
		result: ActionResult<Data, Fields>,
		own: AbortController
	) => {
		if (controller !== own) return result;
		state.set(result);
		if (result.status === 'success' && result.redirect) {
			window.location.assign(result.redirect);
		}

		return result;
	};

	const settle = (own: AbortController) => {
		if (controller !== own) return;
		pending.set(false);
		optimistic.set(undefined);
	};

	const submit = async (body: FormData) => {
		// Before aborting the previous submission: the caller's mapper may
		// throw, and then nothing should have been disturbed.
		const provisional = optimisticValue(options.optimistic, body);
		controller?.abort();
		const own = new AbortController();
		controller = own;
		pending.set(true);
		optimistic.set(provisional);
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

	const errorState = computed(() => {
		const current = state();

		return current.status === 'error' ? current : null;
	});
	/** Give up on the submission in flight. The controller is dropped as
	 *  well as aborted, so a response that still arrives is discarded by
	 *  `adopt`, and `pending` is cleared here because `settle` then sees
	 *  that mismatch and leaves it alone. */
	const abort = () => {
		controller?.abort();
		controller = undefined;
		pending.set(false);
		optimistic.set(undefined);
	};

	return {
		abort,
		data: computed(() => shownActionData(state(), optimistic())),
		errors: computed<ActionFieldErrors<Fields>>(
			() => errorState()?.errors ?? {}
		),
		message: computed(() => errorState()?.message),
		path,
		pending,
		resetOnSuccess,
		state,
		submit,
		values: computed<ActionFormValues<Fields>>(
			() => errorState()?.values ?? {}
		),
		reset: () => {
			state.set(IDLE);
			optimistic.set(undefined);
		}
	};
};
