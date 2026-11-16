import type {
	FormActionDataOf,
	FormActionFieldsOf,
	FormActionPaths
} from '../../types/formAction';
import { getActionState } from '../utils/formActionState';
import {
	formActionReducer,
	submitFormAction,
	type SubmitFormActionOptions
} from './formActions';

/* The typed form-action client: every helper addressed by the form
 * route's path, checked against the app's routes the way Eden reads them
 * (`typeof server['~Routes']`), with the state, data and field errors
 * typed from that route. Browser safe (no server imports), so one
 * `actions` module can be imported by the server's routes and by pages.
 * The React build of this factory (`@absolutejs/absolute/react/hooks`)
 * adds `useFormAction`. */

/** Builds the form-action helpers for `App` (`typeof server`). Pass the
 *  type only (`import type { server } from './server'`), so no server
 *  code reaches the browser:
 *
 *    export const actions = createFormActionClient<typeof server>();
 *    actions.getActionState('/actions/signup'); // in the page's route
 *
 *  In a route of `App` itself, give the handler a return type
 *  (`(): Promise<Response> => …`): TypeScript can't infer a route's type
 *  from code typed by the app the route belongs to. */
export const createFormActionClient = <App>() => ({
	/** Typed `formActionReducer` for React 19's `useActionState`. */
	formActionReducer: <Path extends FormActionPaths<App>>(path: Path) =>
		formActionReducer<
			FormActionDataOf<App, Path>,
			FormActionFieldsOf<App, Path>
		>(path),
	/** Typed `getActionState`: on the server, the result a submission
	 *  without JavaScript left for the page being rendered. */
	getActionState: <Path extends FormActionPaths<App>>(
		path: Path,
		request?: Request
	) =>
		getActionState<
			FormActionDataOf<App, Path>,
			FormActionFieldsOf<App, Path>
		>(path, request),
	/** Typed `submitFormAction`: posts a FormData from the browser. */
	submitFormAction: <Path extends FormActionPaths<App>>(
		path: Path,
		body: FormData,
		options?: SubmitFormActionOptions
	) =>
		submitFormAction<
			FormActionDataOf<App, Path>,
			FormActionFieldsOf<App, Path>
		>(path, body, options)
});
