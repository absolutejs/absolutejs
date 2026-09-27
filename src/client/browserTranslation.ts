import { TRANSLATABLE_ATTRIBUTES } from './browserTranslationAttributes';

type TextBaseline = ReadonlyMap<number, string>;
type SsrTextBaselines = WeakMap<Element, TextBaseline>;
type AttributeBaseline = ReadonlyMap<string, string>;
type SsrAttributeBaselines = WeakMap<Element, AttributeBaseline>;

declare global {
	// Window augmentation requires interface declaration merging.
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
	interface Window {
		__ABSOLUTE_SSR_TEXT_BASELINES__?: SsrTextBaselines;
		__ABSOLUTE_SSR_ATTRIBUTE_BASELINES__?: SsrAttributeBaselines;
	}
}

type TranslatedText = {
	baseline: string;
	index: number;
	path: number[];
	translated: string;
};

type TranslatedAttribute = {
	baseline: string;
	name: string;
	path: number[];
	translated: string;
};

// Translate inserts font wrappers around text. Remove only newly inserted,
// text-only font trees; never flatten authored elements or interactive markup.
const translatedFontText = (
	node: Node | undefined,
	baselines: SsrTextBaselines
) => {
	if (!(node instanceof Element) || node.tagName !== 'FONT') return undefined;
	const elements = [node, ...node.querySelectorAll('*')];
	if (
		elements.some(
			(element) => element.tagName !== 'FONT' || baselines.has(element)
		)
	)
		return undefined;

	return node.textContent ?? '';
};

const translationRestorer = (restore: () => void, hasTranslation: boolean) =>
	Object.assign(restore, { hasTranslation });

const emptyTranslationRestorer = () =>
	translationRestorer(() => undefined, false);

const textNodeAt = (parent: Element, index: number) => {
	const node = parent.childNodes[index];

	return node instanceof Text ? node : undefined;
};

const prepareTextTranslation = (
	element: Element,
	index: number,
	baseline: string,
	path: number[],
	baselines: SsrTextBaselines
) => {
	const original = element.childNodes[index];
	const wrappedText = translatedFontText(original, baselines);
	if (wrappedText !== undefined) {
		original?.replaceWith(document.createTextNode(baseline));

		return { baseline, index, path, translated: wrappedText };
	}
	const node = textNodeAt(element, index);
	if (node === undefined || node.data === baseline) return undefined;
	const snapshot: TranslatedText = {
		baseline,
		index,
		path,
		translated: node.data
	};
	node.data = baseline;

	return snapshot;
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
	const attributes: SsrAttributeBaselines =
		window.__ABSOLUTE_SSR_ATTRIBUTE_BASELINES__ ?? new WeakMap();
	visitElements(root, (element) => {
		const text = new Map<number, string>();
		for (const [index, node] of [...element.childNodes].entries()) {
			if (node.nodeType === Node.TEXT_NODE)
				text.set(index, node.nodeValue ?? '');
		}
		if (text.size > 0) baselines.set(element, text);
		const values = new Map<string, string>();
		for (const name of TRANSLATABLE_ATTRIBUTES) {
			const value = element.getAttribute(name);
			if (value !== null) values.set(name, value);
		}
		if (values.size > 0) attributes.set(element, values);
	});
	window.__ABSOLUTE_SSR_TEXT_BASELINES__ = baselines;
	window.__ABSOLUTE_SSR_ATTRIBUTE_BASELINES__ = attributes;
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
	const translatedAttributes: TranslatedAttribute[] = [];
	const attributes = window.__ABSOLUTE_SSR_ATTRIBUTE_BASELINES__;
	visitElements(root, (element) => {
		const text = baselines.get(element);
		const path = elementPath(root, element);
		if (path === null) return;
		for (const [index, baseline] of text ?? []) {
			const snapshot = prepareTextTranslation(
				element,
				index,
				baseline,
				path,
				baselines
			);
			if (snapshot === undefined) continue;
			translated.push(snapshot);
		}
		for (const [name, baseline] of attributes?.get(element) ?? []) {
			const value = element.getAttribute(name);
			if (value === null || value === baseline) continue;
			translatedAttributes.push({
				baseline,
				name,
				path,
				translated: value
			});
			element.setAttribute(name, baseline);
		}
	});

	return translationRestorer(
		() => {
			for (const snapshot of translated) {
				const parent = elementAtPath(root, snapshot.path);
				if (parent === null) continue;
				const node = textNodeAt(parent, snapshot.index);
				if (node !== undefined && node.data === snapshot.baseline)
					node.data = snapshot.translated;
			}
			for (const snapshot of translatedAttributes) {
				const element = elementAtPath(root, snapshot.path);
				if (element?.getAttribute(snapshot.name) === snapshot.baseline)
					element.setAttribute(snapshot.name, snapshot.translated);
			}
		},
		translated.length > 0 || translatedAttributes.length > 0
	);
};
