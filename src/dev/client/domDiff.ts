/* DOM diffing/patching for in-place updates (zero flicker) */

function getElementKey(el: Node, index: number): string {
	if (el.nodeType !== Node.ELEMENT_NODE) return 'text_' + index;
	const element = el as Element;
	if (element.id) return 'id_' + element.id;
	if (element.hasAttribute('data-key'))
		return 'key_' + element.getAttribute('data-key');
	return 'tag_' + element.tagName + '_' + index;
}

function updateElementAttributes(oldEl: Element, newEl: Element): void {
	const newAttrs = Array.from(newEl.attributes);
	const oldAttrs = Array.from(oldEl.attributes);
	const runtimeAttrs = ['data-hmr-listeners-attached'];

	oldAttrs.forEach(function (oldAttr) {
		if (
			!newEl.hasAttribute(oldAttr.name) &&
			runtimeAttrs.indexOf(oldAttr.name) === -1
		) {
			oldEl.removeAttribute(oldAttr.name);
		}
	});

	newAttrs.forEach(function (newAttr) {
		if (
			runtimeAttrs.indexOf(newAttr.name) !== -1 &&
			oldEl.hasAttribute(newAttr.name)
		) {
			return;
		}
		const oldValue = oldEl.getAttribute(newAttr.name);
		if (oldValue !== newAttr.value) {
			oldEl.setAttribute(newAttr.name, newAttr.value);
		}
	});
}

function updateTextNode(oldNode: Node, newNode: Node): void {
	if (oldNode.nodeValue !== newNode.nodeValue) {
		oldNode.nodeValue = newNode.nodeValue;
	}
}

interface KeyedEntry {
	index: number;
	node: Node;
}

function matchChildren(
	oldChildren: Node[],
	newChildren: Node[]
): { newMap: Map<string, KeyedEntry[]>; oldMap: Map<string, KeyedEntry[]> } {
	const oldMap = new Map<string, KeyedEntry[]>();
	const newMap = new Map<string, KeyedEntry[]>();

	oldChildren.forEach(function (child, idx) {
		const key = getElementKey(child, idx);
		if (!oldMap.has(key)) {
			oldMap.set(key, []);
		}
		oldMap.get(key)!.push({ index: idx, node: child });
	});

	newChildren.forEach(function (child, idx) {
		const key = getElementKey(child, idx);
		if (!newMap.has(key)) {
			newMap.set(key, []);
		}
		newMap.get(key)!.push({ index: idx, node: child });
	});

	return { newMap, oldMap };
}

function isHMRScript(el: Node): boolean {
	return (
		el.nodeType === Node.ELEMENT_NODE &&
		(el as Element).hasAttribute &&
		(el as Element).hasAttribute('data-hmr-client')
	);
}

function isHMRPreserved(el: Node): boolean {
	return (
		isHMRScript(el) ||
		(el.nodeType === Node.ELEMENT_NODE &&
			(el as Element).hasAttribute &&
			(el as Element).hasAttribute('data-hmr-overlay'))
	);
}

function patchNode(oldNode: Node, newNode: Node): void {
	if (
		oldNode.nodeType === Node.TEXT_NODE &&
		newNode.nodeType === Node.TEXT_NODE
	) {
		updateTextNode(oldNode, newNode);
		return;
	}

	if (
		oldNode.nodeType === Node.ELEMENT_NODE &&
		newNode.nodeType === Node.ELEMENT_NODE
	) {
		const oldEl = oldNode as Element;
		const newEl = newNode as Element;

		if (oldEl.tagName !== newEl.tagName) {
			const clone = newEl.cloneNode(true);
			oldEl.replaceWith(clone);
			return;
		}

		updateElementAttributes(oldEl, newEl);

		const oldChildren = Array.from(oldNode.childNodes);
		const newChildren = Array.from(newNode.childNodes);

		const oldChildrenFiltered = oldChildren.filter(function (child) {
			return (
				!isHMRScript(child) &&
				!(
					child.nodeType === Node.ELEMENT_NODE &&
					(child as Element).tagName === 'SCRIPT'
				)
			);
		});
		const newChildrenFiltered = newChildren.filter(function (child) {
			return (
				!isHMRScript(child) &&
				!(
					child.nodeType === Node.ELEMENT_NODE &&
					(child as Element).tagName === 'SCRIPT'
				)
			);
		});

		const { oldMap } = matchChildren(
			oldChildrenFiltered,
			newChildrenFiltered
		);
		const matchedOld = new Set<Node>();

		newChildrenFiltered.forEach(function (newChild, newIndex) {
			const newKey = getElementKey(newChild, newIndex);
			const oldMatches = oldMap.get(newKey) || [];

			if (oldMatches.length > 0) {
				let bestMatch: KeyedEntry | null = null;
				for (let idx = 0; idx < oldMatches.length; idx++) {
					if (!matchedOld.has(oldMatches[idx]!.node)) {
						bestMatch = oldMatches[idx]!;
						break;
					}
				}
				if (!bestMatch && oldMatches.length > 0) {
					bestMatch = oldMatches[0]!;
				}
				if (bestMatch && !matchedOld.has(bestMatch.node)) {
					matchedOld.add(bestMatch.node);
					patchNode(bestMatch.node, newChild);
				} else if (oldMatches.length > 0) {
					const clone = newChild.cloneNode(true);
					oldNode.insertBefore(
						clone,
						oldChildrenFiltered[newIndex] || null
					);
				}
			} else {
				const clone = newChild.cloneNode(true);
				oldNode.insertBefore(
					clone,
					oldChildrenFiltered[newIndex] || null
				);
			}
		});

		oldChildrenFiltered.forEach(function (oldChild) {
			if (!matchedOld.has(oldChild) && !isHMRPreserved(oldChild)) {
				oldChild.remove();
			}
		});
	}
}

export function patchDOMInPlace(
	oldContainer: HTMLElement,
	newHTML: string
): void {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHTML;
	const newContainer = tempDiv;

	const oldChildren = Array.from(oldContainer.childNodes);
	const newChildren = Array.from(newContainer.childNodes);

	const oldChildrenFiltered = oldChildren.filter(function (child) {
		return !(
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName === 'SCRIPT' &&
			!(child as Element).hasAttribute('data-hmr-client')
		);
	});
	const newChildrenFiltered = newChildren.filter(function (child) {
		return !(
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName === 'SCRIPT'
		);
	});

	const { oldMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
	const matchedOld = new Set<Node>();

	newChildrenFiltered.forEach(function (newChild, newIndex) {
		const newKey = getElementKey(newChild, newIndex);
		const oldMatches = oldMap.get(newKey) || [];

		if (oldMatches.length > 0) {
			let bestMatch: KeyedEntry | null = null;
			for (let idx = 0; idx < oldMatches.length; idx++) {
				if (!matchedOld.has(oldMatches[idx]!.node)) {
					bestMatch = oldMatches[idx]!;
					break;
				}
			}
			if (!bestMatch && oldMatches.length > 0) {
				bestMatch = oldMatches[0]!;
			}
			if (bestMatch && !matchedOld.has(bestMatch.node)) {
				matchedOld.add(bestMatch.node);
				patchNode(bestMatch.node, newChild);
			} else {
				const clone = newChild.cloneNode(true);
				oldContainer.insertBefore(
					clone,
					oldChildrenFiltered[newIndex] || null
				);
			}
		} else {
			const clone = newChild.cloneNode(true);
			oldContainer.insertBefore(
				clone,
				oldChildrenFiltered[newIndex] || null
			);
		}
	});

	oldChildrenFiltered.forEach(function (oldChild) {
		if (
			!matchedOld.has(oldChild) &&
			!(
				oldChild.nodeType === Node.ELEMENT_NODE &&
				(oldChild as Element).tagName === 'SCRIPT' &&
				(oldChild as Element).hasAttribute('data-hmr-client')
			) &&
			!(
				oldChild.nodeType === Node.ELEMENT_NODE &&
				(oldChild as Element).hasAttribute &&
				(oldChild as Element).hasAttribute('data-hmr-overlay')
			)
		) {
			oldChild.remove();
		}
	});
}
