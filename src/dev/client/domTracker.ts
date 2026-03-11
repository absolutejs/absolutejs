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

		if (liveText !== newText) {
			const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
			if (liveEl) {
				liveEl.textContent = liveText;
			}
		}
	});

	/* Restore JS-added children (e.g. dynamically appended list items) */
	snapshot.children.forEach((liveHTML, elId) => {
		const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
		const newInner = newEl ? newEl.innerHTML : '';

		if (liveHTML !== newInner && liveHTML.length > newInner.length) {
			const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
			if (liveEl) {
				liveEl.innerHTML = liveHTML;
			}
		}
	});
};
export const snapshotDOMChanges = (root: HTMLElement): DOMSnapshot => {
	const text = new Map<string, string>();
	const children = new Map<string, string>();

	root.querySelectorAll('[id]').forEach((el) => {
		const {childNodes} = el;
		const isTextLeaf = Array.from(childNodes).every(
			(child) => child.nodeType === Node.TEXT_NODE
		);

		if (isTextLeaf && childNodes.length > 0) {
			text.set(el.id, el.textContent || '');
		} else if (el.children.length > 0) {
			children.set(el.id, el.innerHTML);
		}
	});

	return { children, text };
};
