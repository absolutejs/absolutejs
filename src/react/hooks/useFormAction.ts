import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent
} from 'react';
import type {
	ActionFieldErrors,
	ActionFields,
	ActionFormValues,
	ActionIdleState,
	ActionPath,
	ActionStateOf,
	AnyFormAction
} from '../../../types/formAction';
import { submitFormAction } from '../../client/formActions';

export type UseFormActionOptions<Action extends AnyFormAction> = {
	/** The result a submission without JavaScript left for this page:
	 *  `getActionState(action)` in the route, passed down as a prop. */
	initialState?: ActionStateOf<Action>;
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
 * Progressive-enhancement form state for a `defineAction` action:
 *
 *   const signup = useFormAction<typeof createUser>('/users', {
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
 */
export const useFormAction = <Action extends AnyFormAction = AnyFormAction>(
	path: ActionPath<Action>,
	options: UseFormActionOptions<Action> = {}
) => {
	const [state, setState] = useState<ActionStateOf<Action>>(
		() => options.initialState ?? IDLE
	);
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
				const result = await submitFormAction<Action>(path, body, {
					signal: controller.signal
				});
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
	const errors: ActionFieldErrors<ActionFields<Action>> =
		state.status === 'error' ? state.errors : {};
	const values: ActionFormValues<ActionFields<Action>> =
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
