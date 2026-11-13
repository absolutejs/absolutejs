/**
 * Public type surface for form actions (`defineAction` on the server,
 * `useFormAction` / `enhanceForms` in the browser). Browser code imports
 * these types only, so a page can type its form against a server action
 * with `import type { createUser } from '../../server'` and never pull
 * server code into its bundle.
 */

/** Field name → message, one message per field. */
export type ActionFieldErrors<Fields extends string = string> = Partial<
	Record<Fields, string>
>;

/** What the user typed, echoed back after a submission without
 *  JavaScript failed, so the form can be refilled. Files and fields whose
 *  name looks secret (password, token, card…) are never echoed. */
export type ActionFormValues<Fields extends string = string> = Partial<
	Record<Fields, string | string[]>
>;

export type ActionIdleState = { status: 'idle' };

export type ActionSuccessState<Data = unknown> = {
	status: 'success';
	/** The handler's return value. Undefined after a submission without
	 *  JavaScript when the value didn't fit the result cookie (~3.5 KB). */
	data?: Data;
	/** Where the browser goes next, when the action sets `redirect`. */
	redirect?: string;
};

export type ActionErrorState<Fields extends string = string> = {
	status: 'error';
	errors: ActionFieldErrors<Fields>;
	/** A message for the whole form (`fail(errors, message)`, or a
	 *  network / server failure seen by the browser helpers). */
	message?: string;
	values?: ActionFormValues<Fields>;
};

/** What a submission produces. */
export type ActionResult<Data = unknown, Fields extends string = string> =
	ActionErrorState<Fields> | ActionSuccessState<Data>;

/** A form's state: idle until the first submission. */
export type ActionState<Data = unknown, Fields extends string = string> =
	ActionIdleState | ActionResult<Data, Fields>;

/** The phantom type a `defineAction(...)` result carries, so browser code
 *  can name the action with `typeof createUser` and get its path, field
 *  names and result type. */
export type FormActionDefinition<
	Path extends string = string,
	Body = unknown,
	Data = unknown
> = {
	readonly actionPath: Path;
	readonly '~formAction'?: { body: Body; data: Data };
};

export type AnyFormAction = FormActionDefinition;

export type ActionPath<Action extends AnyFormAction> = Action['actionPath'];

export type ActionBody<Action extends AnyFormAction> = NonNullable<
	Action['~formAction']
>['body'];

export type ActionData<Action extends AnyFormAction> = NonNullable<
	Action['~formAction']
>['data'];

/** The body's field names; any string for an untyped action. */
export type ActionFields<Action extends AnyFormAction> =
	unknown extends ActionBody<Action>
		? string
		: Extract<keyof ActionBody<Action>, string>;

export type ActionResultOf<Action extends AnyFormAction> = ActionResult<
	ActionData<Action>,
	ActionFields<Action>
>;

export type ActionStateOf<Action extends AnyFormAction> = ActionState<
	ActionData<Action>,
	ActionFields<Action>
>;
