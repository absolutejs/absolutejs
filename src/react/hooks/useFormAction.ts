import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent
} from 'react';
import type {
	ActionFieldErrors,
	ActionFormValues,
	ActionIdleState,
	ActionState
} from '../../../types/formAction';
import { submitFormAction } from '../../client/formActions';
import { isActionState } from '../../utils/formActionProtocol';

export type UseFormActionOptions = {
	/** The result a submission without JavaScript left for this page:
	 *  `getActionState(path)` in the route, passed down as a prop. It comes
	 *  through a cookie and props, so any action state is accepted; the
	 *  hook's type parameters type it. */
	initialState?: ActionState | null;
	/** Clear the form's fields after a successful submission that doesn't
	 *  redirect. Default true. */
	resetOnSuccess?: boolean;
};

const IDLE: ActionIdleState = { status: 'idle' };

const submitterOf = (event: FormEvent<HTMLFormElement>) => {
	const { nativeEvent } = event;

	return 'submitter' in nativeEvent &&
		nativeEvent.submitter instanceof HTMLElement
		? nativeEvent.submitter
		: null;
};

/**
 * Progressive-enhancement form state for a `form` route:
 *
 *   const signup = actions.useFormAction('/users', {
 *   	initialState: props.signupState
 *   });
 *   <form {...signup.formProps}>
 *   	<input name="name" defaultValue={signup.values.name} />
 *   	{signup.errors.name && <p>{signup.errors.name}</p>}
 *   	<button disabled={signup.pending}>Save</button>
 *   </form>
 *
 * `formProps` renders a real `method="post"` form, so it works before
 * hydration and without JavaScript; once hydrated, submissions go through
 * fetch and `state` / `pending` / `errors` update in place.
 *
 * `actions` is `createFormActionClient<typeof server>()` from this
 * module, which checks the path against the app's form routes and types
 * `data`, `errors` and `values` from the route. Called directly, the hook
 * takes them as type parameters (`useFormAction<Data, Fields>(path)`).
 */
export const useFormAction = <Data = unknown, Fields extends string = string>(
	path: string,
	options: UseFormActionOptions = {}
) => {
	const [state, setState] = useState<ActionState<Data, Fields>>(() => {
		const initial = options.initialState;

		return initial && isActionState<Data, Fields>(initial) ? initial : IDLE;
	});
	const [pending, setPending] = useState(false);
	const controllerRef = useRef<AbortController | null>(null);
	const resetOnSuccess = options.resetOnSuccess !== false;

	useEffect(() => () => controllerRef.current?.abort(), []);

	const submit = useCallback(
		async (body: FormData) => {
			controllerRef.current?.abort();
			const controller = new AbortController();
			controllerRef.current = controller;
			setPending(true);
			try {
				const result = await submitFormAction<Data, Fields>(
					path,
					body,
					{
						signal: controller.signal
					}
				);
				setState(result);
				if (result.status === 'success' && result.redirect)
					window.location.assign(result.redirect);

				return result;
			} finally {
				if (controllerRef.current === controller) setPending(false);
			}
		},
		[path]
	);

	const onSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const form = event.currentTarget;
			const body = new FormData(form, submitterOf(event));
			const clearOnSuccess = async () => {
				const result = await submit(body);
				if (
					result.status === 'success' &&
					!result.redirect &&
					resetOnSuccess
				)
					form.reset();
			};
			// An aborted submission (a newer one replaced it) is not an error.
			clearOnSuccess().catch(() => undefined);
		},
		[resetOnSuccess, submit]
	);

	const reset = useCallback(() => setState(IDLE), []);
	const errors: ActionFieldErrors<Fields> =
		state.status === 'error' ? state.errors : {};
	const values: ActionFormValues<Fields> =
		state.status === 'error' ? (state.values ?? {}) : {};

	return {
		data: state.status === 'success' ? state.data : undefined,
		errors,
		formProps: {
			action: path,
			encType: 'multipart/form-data',
			method: 'post',
			onSubmit
		},
		message: state.status === 'error' ? state.message : undefined,
		pending,
		reset,
		state,
		submit,
		values
	};
};
