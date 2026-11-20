import { defineComponent, h } from 'vue';
import { CSRF_FIELD_NAME, readCsrfToken } from '../../utils/csrfTokenRef';

/** The hidden field a `csrf: { token: true }` form route expects:
 *
 *    <form v-bind="signup.formProps">
 *    	<CsrfField />
 *    	…
 *
 *  The token is read in `setup`, not on every render: it belongs to the
 *  request that rendered the page, and the server markup and the hydrated
 *  DOM have to agree on it. Renders nothing when there is no token — a
 *  route that did not opt in, or a page pre-rendered at build time, whose
 *  submissions carry the token in a header instead. */
export const CsrfField = defineComponent({
	name: 'AbsoluteCsrfField',
	setup() {
		const token = readCsrfToken();

		return () =>
			token
				? h('input', {
						name: CSRF_FIELD_NAME,
						type: 'hidden',
						value: token
					})
				: null;
	}
});
