import { assertNoServerSecrets } from './serverSecrets';

/* One place that turns a page's props into the JSON the browser reads, so
 * the secret check cannot be forgotten by a framework that serializes its
 * own. Callers keep their own escaping (`escapeScriptContent`, React's
 * bootstrap escaping): this returns JSON, not a script. */

/** The JSON for `window.__INITIAL_PROPS__`, refused when it carries a
 *  server secret. `where` names the page, for the error. */
export const serializeInitialProps = (props: unknown, where: string) => {
	const serialized = JSON.stringify(props ?? {});
	assertNoServerSecrets(serialized, where);

	return serialized;
};
