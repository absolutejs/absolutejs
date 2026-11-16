import type {
	FormActionDataOf,
	FormActionFieldsOf,
	FormActionPaths
} from '../../../types/formAction';
import { createFormActionClient as createBaseClient } from '../../client/formActionClient';
import { useFormAction, type UseFormActionOptions } from './useFormAction';

/** Builds the typed form-action helpers for `App` (`typeof server`),
 *  with `useFormAction` for React pages. Pass the type only
 *  (`import type { server } from '../server'`), so no server code reaches
 *  the browser:
 *
 *    export const actions = createFormActionClient<typeof server>();
 *    // the page's route (server):
 *    props: { signupState: actions.getActionState('/actions/signup') ?? null }
 *    // the page (browser):
 *    const signup = actions.useFormAction('/actions/signup', {
 *    	initialState: signupState
 *    });
 *
 *  Paths are checked against the app's `form` routes; `state`, `data`,
 *  `errors` and `values` are typed from the route. */
export const createFormActionClient = <App>() => ({
	...createBaseClient<App>(),
	/** Typed `useFormAction`. */
	useFormAction: <Path extends FormActionPaths<App>>(
		path: Path,
		options?: UseFormActionOptions
	) =>
		useFormAction<
			FormActionDataOf<App, Path>,
			FormActionFieldsOf<App, Path>
		>(path, options)
});
