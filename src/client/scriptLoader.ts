/* `strategy="lazyOnload"`: the tag is not in the page at all, and the
 * client adds it once the window has loaded and the main thread is idle.
 *
 * The DOM is the registry. A tag that has run carries its identity marker
 * and stays in the document — on a soft navigation the navigation layer
 * carries that element over rather than recreating it — so "has this
 * already loaded?" is a query against the live document rather than a set
 * kept on `globalThis`. There is nothing to seed, nothing to invalidate,
 * and nothing that can disagree with what the page actually contains.
 *
 * That matters more here than it looks. A soft navigation re-runs the
 * incoming page's module entries under a fresh URL, so module scope is
 * NOT shared across a visit (see client/islandHydrationState.ts, where
 * exactly that assumption made an island mount once per visit squared).
 * A module-level `Set` of loaded scripts would have been empty on arrival
 * and every lazy script would have been added again. */

import type { ScriptProps } from '../../types/script';
import {
	insertedScriptAttributes,
	scriptIdentity
} from '../utils/scriptAttributes';
import { SCRIPT_MARKER } from './scriptMarker';

const IDLE_TIMEOUT_MS = 2000;

const alreadyInDocument = (identity: string | undefined) => {
	if (identity === undefined) return false;
	const selector = `script[${SCRIPT_MARKER}="${CSS.escape(identity)}"]`;

	return document.querySelector(selector) !== null;
};

const whenIdle = (run: () => void) => {
	const idle: unknown = Reflect.get(window, 'requestIdleCallback');
	if (typeof idle === 'function') {
		Reflect.apply(idle, window, [run, { timeout: IDLE_TIMEOUT_MS }]);

		return;
	}
	window.setTimeout(run, 0);
};

const insert = (props: ScriptProps) => {
	if (alreadyInDocument(scriptIdentity(props))) return;
	const element = document.createElement('script');
	const attributes = insertedScriptAttributes(props);
	for (const [name, value] of Object.entries(attributes ?? {}))
		element.setAttribute(name, value);
	if (props.code !== undefined) element.text = props.code;
	document.head.append(element);
};

/** Adds the tag after the window `load` event, on an idle frame. Safe to
 *  call more than once for the same script: the second call finds the tag
 *  already in the document and does nothing, which is what makes this
 *  survive a soft navigation and a re-render alike. */
export const loadLazyScript = (props: ScriptProps) => {
	if (typeof document === 'undefined') return;
	if (alreadyInDocument(scriptIdentity(props))) return;
	if (document.readyState === 'complete') {
		whenIdle(() => insert(props));

		return;
	}
	window.addEventListener('load', () => whenIdle(() => insert(props)), {
		once: true
	});
};
