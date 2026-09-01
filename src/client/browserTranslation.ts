type TextBaseline = ReadonlyMap<number, string>;
type SsrTextBaselines = WeakMap<Element, TextBaseline>;

declare global {
	// Window augmentation requires interface declaration merging.
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
	interface Window {
		__ABSOLUTE_SSR_TEXT_BASELINES__?: SsrTextBaselines;
	}
}

type TranslatedText = {
	baseline: string;
	index: number;
	path: number[];
	translated: string;
};

const translationRestorer = (restore: () => void, hasTranslation: boolean) =>
	Object.assign(restore, { hasTranslation });

const emptyTranslationRestorer = () =>
	translationRestorer(() => undefined, false);

const textNodeAt = (parent: Element, index: number) => {
	const node = parent.childNodes[index];

	return node instanceof Text ? node : undefined;
};

const visitElements = (root: Element, visit: (element: Element) => void) => {
	visit(root);
	for (const element of root.querySelectorAll('*')) visit(element);
};

const elementPath = (root: Element, element: Element) => {
	const path: number[] = [];
	let current = element;
	while (current !== root) {
		const parent = current.parentElement;
		if (parent === null) return null;
		path.unshift([...parent.children].indexOf(current));
		current = parent;
	}

	return path;
};

const elementAtPath = (root: Element, path: number[]) => {
	let current = root;
	for (const index of path) {
		const child = current.children[index];
		if (!(child instanceof Element)) return null;
		current = child;
	}

	return current;
};

/** Capture server-authored text before client modules load. Absolute page
 * handlers install the same snapshot inline; this export supports custom
 * documents and non-standard bootstraps. */
export const captureSsrTextBaselines = (root: Element | null) => {
	if (root === null || typeof window === 'undefined') return;
	const baselines: SsrTextBaselines =
		window.__ABSOLUTE_SSR_TEXT_BASELINES__ ?? new WeakMap();
	visitElements(root, (element) => {
		const text = new Map<number, string>();
		for (const [index, node] of [...element.childNodes].entries()) {
			if (node.nodeType === Node.TEXT_NODE)
				text.set(index, node.nodeValue ?? '');
		}
		if (text.size > 0) baselines.set(element, text);
	});
	window.__ABSOLUTE_SSR_TEXT_BASELINES__ = baselines;
};

/** Temporarily restore server text while a framework attaches to SSR DOM,
 * then reapply translated text. Paths preserve translations even when a
 * framework replaces nodes while mounting. Genuine server/client mismatches
 * are left unchanged. */
export const prepareBrowserTranslationHydration = (root: Element | null) => {
	if (root === null || typeof window === 'undefined')
		return emptyTranslationRestorer();
	const baselines = window.__ABSOLUTE_SSR_TEXT_BASELINES__;
	if (baselines === undefined) return emptyTranslationRestorer();
	const translated: TranslatedText[] = [];
	visitElements(root, (element) => {
		const text = baselines.get(element);
		const path = elementPath(root, element);
		if (text === undefined || path === null) return;
		for (const [index, baseline] of text) {
			const node = textNodeAt(element, index);
			if (node === undefined || node.data === baseline) continue;
			translated.push({ baseline, index, path, translated: node.data });
			node.data = baseline;
		}
	});

	return translationRestorer(() => {
		for (const snapshot of translated) {
			const parent = elementAtPath(root, snapshot.path);
			if (parent === null) continue;
			const node = textNodeAt(parent, snapshot.index);
			if (node !== undefined && node.data === snapshot.baseline)
				node.data = snapshot.translated;
		}
	}, translated.length > 0);
};
