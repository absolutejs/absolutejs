/* Snapshot/restore for JS-modified DOM state across HMR updates.
 * Before patching, captures text and dynamic children of elements with IDs.
 * After patching, restores values that were changed by user scripts. */

type DOMSnapshot = {
	children: Map<string, string>;
	text: Map<string, string>;
};

export const restoreDOMChanges = (
	root: HTMLElement,
	snapshot: DOMSnapshot,
	newHTML: string
) => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHTML;

	/* Restore JS-modified text on leaf elements */
	snapshot.text.forEach((liveText, elId) => {
		const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
		const newText = newEl ? newEl.textContent || '' : '';
		if (liveText === newText) return;

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

		const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
		if (!liveEl) return;

		/* Skip the wholesale innerHTML restore when this subtree still holds an
		 * id'd descendant: those are tracked and restored individually (the
		 * text/children maps) and patchDOMInPlace already preserved their node
		 * identity. Reassigning innerHTML here rebuilds them into fresh nodes,
		 * orphaning any element reference (and its listeners) a user script
		 * captured — e.g. a counter script holding `#counter` whose parent
		 * `#counter-button` gets clobbered, freezing the button. Id-less
		 * dynamic children (JS-appended list items) have no such descendant and
		 * still restore. */
		if (liveEl.querySelector('[id]')) return;
		liveEl.innerHTML = liveHTML;
	});
};
export const snapshotDOMChanges = (root: HTMLElement): DOMSnapshot => {
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
