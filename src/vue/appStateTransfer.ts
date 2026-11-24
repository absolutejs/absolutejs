/* Handing app-level state from the server render to the browser.
 *
 * A page can already install anything on the Vue app through `setupApp`,
 * which runs on both sides — so a project could install Pinia today and
 * have it work on each side separately. What it could not do is get the
 * state ACROSS: Pinia fills its stores during the server render, the
 * browser creates a fresh instance, and every store resets on mount. The
 * visitor sees the server's values, then a flash as hydration replaces
 * them with empty ones, and anything the client refetches is work the
 * server already did.
 *
 * This is a channel rather than Pinia support: the framework does not
 * depend on Pinia and should not, and the same two calls serve any store
 * a project brings. See docs/VUE_APP_STATE.md for the Pinia recipe.
 *
 * The snapshot is taken AFTER the render rather than when it is
 * registered, because that is when a store has its values — registering
 * during `setupApp` and serializing immediately would capture an empty
 * store every time. */

import { escapeScriptContent } from '../utils/escapeScriptContent';
import { nonceAttr } from '../utils/cspNonceRef';

export const APP_STATE_GLOBAL = '__ABSOLUTE_APP_STATE__';

export type AppStateTransfer = {
	snapshots: Map<string, () => unknown>;
};

export const createAppStateTransfer = () => {
	const transfer: AppStateTransfer = { snapshots: new Map() };

	return transfer;
};

/* A store holding something JSON cannot carry — a Map, a class instance,
 * a function — would otherwise fail the whole page at the last moment,
 * after a successful render. One key is dropped and named instead. */
const serializeEntry = (key: string, snapshot: () => unknown) => {
	try {
		const json = JSON.stringify(snapshot());
		/* `JSON.stringify` RETURNS undefined for a function or a symbol
		 * rather than throwing, so without this the page received
		 * `{"key":undefined}` — not a syntax error, which is what makes
		 * it worth catching: the transfer would silently carry nothing
		 * and look like it worked. */
		if (json === undefined) throw new Error('value is not JSON');

		return [`${JSON.stringify(key)}:${json}`];
	} catch (cause) {
		console.error(
			`[absolutejs] Vue app state "${key}" could not be serialized and was not transferred:`,
			cause
		);

		return [];
	}
};

/** The `<script>` carrying every registered snapshot, or '' when a page
 *  transferred nothing — which is every page that does not ask. */
export const serializeAppStateScript = (transfer: AppStateTransfer) => {
	if (transfer.snapshots.size === 0) return '';
	const entries = [...transfer.snapshots].flatMap(([key, snapshot]) =>
		serializeEntry(key, snapshot)
	);
	if (entries.length === 0) return '';

	return `<script${nonceAttr()}>window.${APP_STATE_GLOBAL}=${escapeScriptContent(`{${entries.join(',')}}`)}</script>`;
};
