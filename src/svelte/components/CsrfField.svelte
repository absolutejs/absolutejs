<script lang="ts">
	import { CSRF_FIELD_NAME, readCsrfToken } from '../../utils/csrfTokenRef';

	/* The hidden field a `csrf: { token: true }` form route expects.
	 *
	 * Read once, not reactively: the token belongs to the request that
	 * rendered this page, and the server-rendered markup and the hydrated
	 * DOM have to agree on it. Renders nothing without a token — a route
	 * that did not opt in, or a page pre-rendered at build time, whose
	 * submissions carry the token in a header instead. */
	const token = readCsrfToken();
</script>

{#if token}
	<input type="hidden" name={CSRF_FIELD_NAME} value={token} />
{/if}
