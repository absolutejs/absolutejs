/* Snapshot/restore for JS-modified DOM state across HMR updates.
 * Before patching, captures text and dynamic children of elements with IDs.
 * After patching, restores values that were changed by user scripts.
 *
 * "Changed by user scripts" means the live value differs from what the
 * server last sent for that element (the baseline), not from what it sends
 * now. Comparing against the new markup alone would treat every edited
 * text as a script change and put the old text back. The baseline is the
 * page as parsed when the HMR client starts (captureServerDOM), then each
 * update's markup. */

type DOMSnapshot = {
	children: Map<string, string>;
	text: Map<string, string>;
};

let serverBaseline: DOMSnapshot | null = null;

const collectIdState = (root: ParentNode): DOMSnapshot => {
	const text = new Map<string, string>();
	const children = new Map<string, string>();

	root.querySelectorAll('[id]').forEach((elem) => {
		const { childNodes } = elem;
		const isTextLeaf = Array.from(childNodes).every(
			(child) => child.nodeType === Node.TEXT_NODE
		);

		if (isTextLeaf && childNodes.length > 0) {
			text.set(elem.id, elem.textContent || '');
		} else if (elem.children.length > 0) {
			children.set(elem.id, elem.innerHTML);
		}
	});

	return { children, text };
};

/* Record the server-rendered DOM as the baseline. Call once, when the HMR
 * client starts: it runs at the end of <body>, before most page scripts
 * have changed anything. */
export const captureServerDOM = (root: ParentNode | null | undefined) => {
	if (!root || serverBaseline) return;
	serverBaseline = collectIdState(root);
};

/* True when the live value still matches what the server last sent, i.e.
 * no script touched it: the new server value wins. */
const isUntouched = (
	baseline: Map<string, string> | undefined,
	elId: string,
	liveValue: string
) => baseline?.has(elId) === true && baseline.get(elId) === liveValue;

export const restoreDOMChanges = (
	root: HTMLElement,
	snapshot: DOMSnapshot,
	newHTML: string
) => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHTML;
	const baseline = serverBaseline;

	/* Restore JS-modified text on leaf elements */
	snapshot.text.forEach((liveText, elId) => {
		const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
		const newText = newEl ? newEl.textContent || '' : '';
		if (liveText === newText) return;
		if (isUntouched(baseline?.text, elId, liveText)) return;

		const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
		if (liveEl) {
			liveEl.textContent = liveText;
		}
	});

	/* Restore JS-added children (e.g. dynamically appended list items) */
	snapshot.children.forEach((liveHTML, elId) => {
		const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
		const newInner = newEl ? newEl.innerHTML : '';
		if (liveHTML === newInner || liveHTML.length <= newInner.length) return;
		if (isUntouched(baseline?.children, elId, liveHTML)) return;

		const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
		if (liveEl) {
			liveEl.innerHTML = liveHTML;
		}
	});

	// The markup just applied is what the server sent last.
	serverBaseline = collectIdState(tempDiv);
};
export const snapshotDOMChanges = (root: HTMLElement) => collectIdState(root);
