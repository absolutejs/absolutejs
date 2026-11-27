/* Making one DOM tree match another by changing only what differs.
 *
 * A page with no framework has its state in the document itself: the
 * text in a field, which `<details>` is open, where a list has been
 * scrolled to, the listeners a script attached. Replacing the body to
 * show new data throws all of that away. Morphing keeps every node that
 * is still wanted — matched to its counterpart in the new document —
 * and adds, moves and removes only the rest. A node that is kept keeps
 * everything attached to it.
 *
 * Written for this purpose rather than taken from the dev server's
 * hot-reload patcher, which is good enough when a wrong patch costs a
 * reload: that one places new nodes by their OLD position and never
 * moves a kept one, so an item added to the top of a list ends up
 * somewhere in the middle of it.
 *
 * WHAT IS LEFT ALONE, on purpose:
 *
 * - An island (`data-island="true"`) and anything marked
 *   `data-absolute-preserve` or `hx-preserve`: a framework or a script
 *   owns what is inside.
 * - What the visitor did to a control. An attribute is the control's
 *   default and the property is its state; only attributes are synced,
 *   so a field that was typed in keeps its text and one that was not
 *   takes the server's new default.
 * - Whether a `<details>` or `<dialog>` is open. That state IS the
 *   attribute, so syncing it would close whatever the visitor opened.
 * - Scripts. One that is already there is not run again, and a new one
 *   is not run at all: a refresh is new data, not new behaviour. */

const KEY_ATTRIBUTE = 'data-key';
const OWNED = '[data-island="true"], [data-absolute-preserve], [hx-preserve]';
const KEPT_OPEN = new Set(['DETAILS', 'DIALOG']);

type Morphing = {
	/** The page's CSP nonce, given to any element that arrives with one. */
	nonce: string | undefined;
};

const isElement = (node: Node): node is Element =>
	node.nodeType === Node.ELEMENT_NODE;

const keyOf = (node: Node) => {
	if (!isElement(node)) return undefined;
	if (node.id !== '') return `#${node.id}`;
	const key = node.getAttribute(KEY_ATTRIBUTE);

	return key === null ? undefined : `key:${key}`;
};

/* Whether `old` may become `wanted`: the same kind of node, and — when
 * either says who it is — the same one. An element with an id is never
 * turned into a different element; that is what makes a reordered list
 * move its rows instead of rewriting each row into its neighbour. */
const canBecome = (old: Node, wanted: Node) => {
	if (old.nodeType !== wanted.nodeType) return false;
	if (!isElement(old) || !isElement(wanted))
		return old.nodeType === Node.TEXT_NODE || old.nodeType === 8;
	if (old.tagName !== wanted.tagName) return false;

	return keyOf(old) === keyOf(wanted);
};

const isScript = (node: Node) => isElement(node) && node.tagName === 'SCRIPT';

const isOwned = (element: Element) => element.matches(OWNED);

const keepsOwnState = (element: Element, name: string) =>
	name === 'open' && KEPT_OPEN.has(element.tagName);

/* A nonce in fetched HTML is the one that response was served with, not
 * this document's; the browser would refuse the element. */
const adoptNonce = (node: Node, { nonce }: Morphing) => {
	if (nonce === undefined || !isElement(node)) return;
	[node, ...node.querySelectorAll('[nonce]')].forEach((element) => {
		if (element.hasAttribute('nonce')) element.setAttribute('nonce', nonce);
	});
};

const syncAttributes = (old: Element, wanted: Element) => {
	Array.from(old.attributes).forEach(({ name }) => {
		if (wanted.hasAttribute(name) || keepsOwnState(old, name)) return;
		old.removeAttribute(name);
	});
	Array.from(wanted.attributes).forEach(({ name, value }) => {
		if (name === 'nonce' || keepsOwnState(old, name)) return;
		if (old.getAttribute(name) !== value) old.setAttribute(name, value);
	});
};

/* The node among `candidates` that `wanted` should be made from: the one
 * in place if it will do, otherwise the one further on that has the same
 * identity — which is then moved up. Only a keyed node is looked for
 * further on; an anonymous one that does not match where it stands is
 * simply new. */
const findMatch = (candidates: Node[], wanted: Node) => {
	const [here] = candidates;
	if (here && canBecome(here, wanted)) return here;
	const key = keyOf(wanted);
	if (key === undefined) return undefined;

	return candidates.find(
		(candidate) => keyOf(candidate) === key && canBecome(candidate, wanted)
	);
};

const syncText = (old: Node, wanted: Node) => {
	if (old.nodeValue !== wanted.nodeValue) old.nodeValue = wanted.nodeValue;
};

/* Whether a kept element is gone into: not when something else owns
 * what is inside it, and not a script. */
const isEntered = (old: Node, wanted: Node): old is Element =>
	isElement(old) && isElement(wanted) && !isOwned(old) && !isScript(old);

const arrive = (
	parent: Node,
	wantedChild: Node,
	before: Node | undefined,
	morphing: Morphing
) => {
	const arriving = document.importNode(wantedChild, true);
	adoptNonce(arriving, morphing);
	parent.insertBefore(arriving, before ?? null);
};

/* Makes `parent`'s children match `wanted`'s, keeping every node that
 * has a counterpart. */
const morphChildren = (
	parent: Node,
	wanted: Node,
	morphing: Morphing
): void => {
	const remaining: Node[] = Array.from(parent.childNodes);
	Array.from(wanted.childNodes)
		// A new script is not run; see the head of this file.
		.filter((wantedChild) => !isScript(wantedChild))
		.forEach((wantedChild) => {
			const match = findMatch(remaining, wantedChild);
			const [here] = remaining;
			if (!match) {
				arrive(parent, wantedChild, here, morphing);

				return;
			}
			remaining.splice(remaining.indexOf(match), 1);
			if (match !== here) parent.insertBefore(match, here ?? null);
			if (!isElement(match)) syncText(match, wantedChild);
			if (!isEntered(match, wantedChild) || !isElement(wantedChild))
				return;
			syncAttributes(match, wantedChild);
			morphChildren(match, wantedChild, morphing);
		});
	// Whatever was not wanted goes — except what is not ours to remove.
	remaining
		.filter(
			(node) => !isScript(node) && !(isElement(node) && isOwned(node))
		)
		.forEach((node) => node.parentNode?.removeChild(node));
};

/** Makes the live document's body match `next`'s: its attributes, and
 *  everything in it. */
export const morphBody = (next: Document) => {
	const morphing: Morphing = {
		nonce:
			document.querySelector<HTMLElement>('script[nonce], style[nonce]')
				?.nonce || undefined
	};
	syncAttributes(document.documentElement, next.documentElement);
	syncAttributes(document.body, next.body);
	morphChildren(document.body, next.body, morphing);
};
