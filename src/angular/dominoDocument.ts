import type { AngularDeps } from '../../types/angular';

const patchChildren = (head: any) => {
	const elementNodes = Array.from(head.childNodes).filter(
		(node: any) => node.nodeType === 1
	);
	const childrenArray: any[] = [];
	elementNodes.forEach((node, index) => {
		childrenArray[index] = node;
	});
	childrenArray.length = elementNodes.length;
	Object.defineProperty(head, 'children', {
		configurable: false,
		enumerable: true,
		value: childrenArray,
		writable: false
	});
};

const ensureDocHead = (doc: Document) => {
	if (doc.head) {
		return;
	}

	const head = doc.createElement('head');
	if (!doc.documentElement) {
		return;
	}

	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
};

const patchDocHeadChildren = (doc: Document) => {
	if (!doc.head) {
		return;
	}

	const { children } = doc.head;
	const needsPatch =
		!children ||
		typeof children.length === 'undefined' ||
		(children[0] === undefined && children.length > 0);

	if (needsPatch) {
		patchChildren(doc.head);
	}
};

export const createDominoDocument = (
	htmlString: string,
	domino: AngularDeps['domino']
) => {
	if (!domino?.createWindow) return htmlString as string | Document;

	try {
		const win = domino.createWindow(htmlString, '/');
		const doc = win.document;
		ensureDocHead(doc);
		// children is instance-specific (depends on actual child nodes)
		// — must be patched per-document unlike querySelector/querySelectorAll
		// which are patched on the prototype once during init.
		patchDocHeadChildren(doc);

		return doc as string | Document;
	} catch (err) {
		console.error(
			'Failed to parse document with domino, using string:',
			err
		);

		return htmlString as string | Document;
	}
};
