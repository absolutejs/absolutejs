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
import {
	isActionState,
	optimisticValue,
	shownActionData
} from '../../utils/formActionProtocol';

export type UseFormActionOptions<Data = unknown> = {
	/** The result a submission without JavaScript left for this page:
	 *  `getActionState(path)` in the route, passed down as a prop. It comes
	 *  through a cookie and props, so any action state is accepted; the
	 *  hook's type parameters type it. */
	initialState?: ActionState | null;
	/** What to show as `data` while the submission is in flight, derived
	 *  from what is being sent. Called once per submission, before the
	 *  request starts; the real result replaces it, and a failure clears
	 *  it so `errors` are what the form shows.
	 *
	 *  `pending` is what says the value is provisional, so treat `data`
	 *  as confirmed only when `pending` is false. A mapper that throws is
	 *  reported to the console and the submission continues without a
	 *  provisional value: it decorates the wait, and the form still has
	 *  work to do. */
	optimistic?(body: FormData): Data;
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
	options: UseFormActionOptions<Data> = {}
) => {
	const [state, setState] = useState<ActionState<Data, Fields>>(() => {
		const initial = options.initialState;

		return initial && isActionState<Data, Fields>(initial) ? initial : IDLE;
	});
	const [pending, setPending] = useState(false);
	// Wrapped, so a provisional `undefined` is still distinguishable from
	// "no submission in flight".
	const [optimistic, setOptimistic] = useState<{ value: Data } | undefined>(
		undefined
	);
	const controllerRef = useRef<AbortController | null>(null);
	const resetOnSuccess = options.resetOnSuccess !== false;
	// Through a ref, so an inline mapper does not make `submit` a new
	// function on every render.
	const optimisticRef = useRef(options.optimistic);
	optimisticRef.current = options.optimistic;

	useEffect(() => () => controllerRef.current?.abort(), []);

	const settle = useCallback(() => {
		setPending(false);
		setOptimistic(undefined);
	}, []);

	const submit = useCallback(
		async (body: FormData) => {
			// Before aborting the previous submission: the caller's mapper
			// may throw, and then nothing should have been disturbed.
			const provisional = optimisticValue(optimisticRef.current, body);
			controllerRef.current?.abort();
			const controller = new AbortController();
			controllerRef.current = controller;
			setPending(true);
			setOptimistic(provisional);
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
				if (controllerRef.current === controller) settle();
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

	const reset = useCallback(() => {
		setState(IDLE);
		setOptimistic(undefined);
	}, []);
	const errors: ActionFieldErrors<Fields> =
		state.status === 'error' ? state.errors : {};
	const values: ActionFormValues<Fields> =
		state.status === 'error' ? (state.values ?? {}) : {};

	return {
		data: shownActionData(state, optimistic),
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
