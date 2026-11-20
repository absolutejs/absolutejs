import { CSRF_FIELD_NAME, readCsrfToken } from '../../utils/csrfTokenRef';

/** The hidden field a `csrf: { token: true }` form route expects:
 *
 *    <form {...signup.formProps}>
 *    	<CsrfField />
 *    	…
 *
 *  Renders nothing when there is no token — a route that did not opt in,
 *  or a page pre-rendered at build time, where no per-visitor token
 *  exists. A pre-rendered page's submissions carry the token in a header
 *  instead, which `submitFormAction` adds from the cookie, so leaving this
 *  in a pre-rendered form is correct and costs nothing. */
export const CsrfField = () => {
	const token = readCsrfToken();
	if (!token) return null;

	return <input name={CSRF_FIELD_NAME} type="hidden" value={token} />;
};
