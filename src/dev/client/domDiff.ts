/* DOM diffing/patching for in-place updates (zero flicker) */

import { UNFOUND_INDEX } from '../../constants';

type KeyedEntry = {
	index: number;
	node: Node;
};

const getElementKey = (elem: Node, index: number) => {
	if (elem.nodeType !== Node.ELEMENT_NODE) return `text_${index}`;
	if (!(elem instanceof Element)) return `text_${index}`;
	if (elem.id) return `id_${elem.id}`;
	if (elem.hasAttribute('data-key'))
		return `key_${elem.getAttribute('data-key')}`;

	return `tag_${elem.tagName}_${index}`;
};

const updateElementAttributes = (oldEl: Element, newEl: Element) => {
	const newAttrs = Array.from(newEl.attributes);
	const oldAttrs = Array.from(oldEl.attributes);
	const runtimeAttrs = ['data-hmr-listeners-attached'];

	oldAttrs.forEach((oldAttr) => {
		if (
			!newEl.hasAttribute(oldAttr.name) &&
			runtimeAttrs.indexOf(oldAttr.name) === UNFOUND_INDEX
		) {
			oldEl.removeAttribute(oldAttr.name);
		}
	});

	newAttrs.forEach((newAttr) => {
		if (
			runtimeAttrs.indexOf(newAttr.name) !== UNFOUND_INDEX &&
			oldEl.hasAttribute(newAttr.name)
		) {
			return;
		}
		const oldValue = oldEl.getAttribute(newAttr.name);
		if (oldValue !== newAttr.value) {
			oldEl.setAttribute(newAttr.name, newAttr.value);
		}
	});
};

const updateTextNode = (oldNode: Node, newNode: Node) => {
	if (oldNode.nodeValue !== newNode.nodeValue) {
		oldNode.nodeValue = newNode.nodeValue;
	}
};

const matchChildren = (oldChildren: Node[], newChildren: Node[]) => {
	const oldMap = new Map<string, KeyedEntry[]>();
	const newMap = new Map<string, KeyedEntry[]>();

	oldChildren.forEach((child, idx) => {
		const key = getElementKey(child, idx);
		if (!oldMap.has(key)) {
			oldMap.set(key, []);
		}
		oldMap.get(key)?.push({ index: idx, node: child });
	});

	newChildren.forEach((child, idx) => {
		const key = getElementKey(child, idx);
		if (!newMap.has(key)) {
			newMap.set(key, []);
		}
		newMap.get(key)?.push({ index: idx, node: child });
	});

	return { newMap, oldMap };
};

const isHMRScript = (elem: Node) =>
	elem instanceof Element && elem.hasAttribute('data-hmr-client');

const isHMRPreserved = (elem: Node) =>
	isHMRScript(elem) ||
	(elem instanceof Element && elem.hasAttribute('data-hmr-overlay'));

const isNonHMRScript = (child: Node) =>
	child instanceof Element && child.tagName === 'SCRIPT';

const findBestMatch = (oldMatches: KeyedEntry[], matchedOld: Set<Node>) => {
	const unmatched = oldMatches.find((entry) => !matchedOld.has(entry.node));
	if (unmatched) return unmatched;
	if (oldMatches.length > 0) return oldMatches[0] ?? null;

	return null;
};

const reconcileChild = (
	newChild: Node,
	newIndex: number,
	oldMap: Map<string, KeyedEntry[]>,
	matchedOld: Set<Node>,
	parentNode: Node,
	oldChildrenFiltered: Node[]
) => {
	const newKey = getElementKey(newChild, newIndex);
	const oldMatches = oldMap.get(newKey) || [];

	if (oldMatches.length === 0) {
		const clone = newChild.cloneNode(true);
		parentNode.insertBefore(clone, oldChildrenFiltered[newIndex] || null);

		return;
	}

	const bestMatch = findBestMatch(oldMatches, matchedOld);
	if (bestMatch && !matchedOld.has(bestMatch.node)) {
		matchedOld.add(bestMatch.node);
		patchNode(bestMatch.node, newChild);

		return;
	}

	const clone = newChild.cloneNode(true);
	parentNode.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
};

const patchNode = (oldNode: Node, newNode: Node) => {
	if (
		oldNode.nodeType === Node.TEXT_NODE &&
		newNode.nodeType === Node.TEXT_NODE
	) {
		updateTextNode(oldNode, newNode);

		return;
	}

	if (
		oldNode.nodeType !== Node.ELEMENT_NODE ||
		newNode.nodeType !== Node.ELEMENT_NODE
	) {
		return;
	}

	if (!(oldNode instanceof Element) || !(newNode instanceof Element)) return;
	const oldEl = oldNode;
	const newEl = newNode;

	if (oldEl.tagName !== newEl.tagName) {
		const clone = newEl.cloneNode(true);
		oldEl.replaceWith(clone);

		return;
	}

	updateElementAttributes(oldEl, newEl);

	const oldChildren = Array.from(oldNode.childNodes);
	const newChildren = Array.from(newNode.childNodes);

	const oldChildrenFiltered = oldChildren.filter(
		(child) => !isHMRScript(child) && !isNonHMRScript(child)
	);
	const newChildrenFiltered = newChildren.filter(
		(child) => !isHMRScript(child) && !isNonHMRScript(child)
	);

	const { oldMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
	const matchedOld = new Set<Node>();

	newChildrenFiltered.forEach((newChild, newIndex) => {
		reconcileChild(
			newChild,
			newIndex,
			oldMap,
			matchedOld,
			oldNode,
			oldChildrenFiltered
		);
	});

	oldChildrenFiltered.forEach((oldChild) => {
		if (!matchedOld.has(oldChild) && !isHMRPreserved(oldChild)) {
			oldChild.remove();
		}
	});
};

export const patchDOMInPlace = (oldContainer: HTMLElement, newHTML: string) => {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHTML;
	const newContainer = tempDiv;

	const oldChildren = Array.from(oldContainer.childNodes);
	const newChildren = Array.from(newContainer.childNodes);

	const oldChildrenFiltered = oldChildren.filter(
		(child) =>
			!(
				child instanceof Element &&
				child.tagName === 'SCRIPT' &&
				!child.hasAttribute('data-hmr-client')
			)
	);
	const newChildrenFiltered = newChildren.filter(
		(child) => !isNonHMRScript(child)
	);

	const { oldMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
	const matchedOld = new Set<Node>();

	newChildrenFiltered.forEach((newChild, newIndex) => {
		reconcileChild(
			newChild,
			newIndex,
			oldMap,
			matchedOld,
			oldContainer,
			oldChildrenFiltered
		);
	});

	oldChildrenFiltered.forEach((oldChild) => {
		if (matchedOld.has(oldChild)) return;
		if (isHMRPreserved(oldChild)) return;
		oldChild.remove();
	});
};
