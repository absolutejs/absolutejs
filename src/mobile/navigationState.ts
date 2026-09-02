/* eslint-disable absolute/max-depth-extended, absolute/sort-exports -- Element-kind branches and lifecycle-order exports keep capture/restoration behavior auditable beside each DOM API. */

export type AbsoluteMobileHistoryEntry = {
	absoluteMobile: true;
	entryId: string;
	index: number;
	path: string;
};

type ElementLocator =
	| { kind: 'id'; value: string }
	| { kind: 'index'; index: number }
	| { kind: 'name'; index: number; value: string };

type ControlSnapshot = {
	checked?: boolean;
	locator: ElementLocator;
	open?: boolean;
	selectionEnd?: number;
	selectionStart?: number;
	tag: string;
	value?: string;
	values?: string[];
};

type ScrollSnapshot = {
	left: number;
	locator: ElementLocator;
	top: number;
};

export type AbsoluteMobileDocumentSnapshot = {
	controls: ControlSnapshot[];
	focus?: ElementLocator;
	scroll: ScrollSnapshot[];
	window: { x: number; y: number };
};

const CONTROL_SELECTOR =
	'input, textarea, select, details, [contenteditable="true"]';
const FOCUS_SELECTOR =
	'[data-absolute-navigation-focus], button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
const SCROLL_SELECTOR =
	'[data-absolute-app-main], [data-absolute-scroll-restoration]';
const SENSITIVE_AUTOCOMPLETE = new Set([
	'cc-csc',
	'cc-number',
	'current-password',
	'new-password',
	'one-time-code'
]);

const locatorFor = (
	element: Element,
	elements: readonly Element[]
): ElementLocator => {
	if (element.id) return { kind: 'id', value: element.id };
	const name = element.getAttribute('name');
	if (name) {
		const matching = elements.filter(
			(candidate) => candidate.getAttribute('name') === name
		);

		return { index: matching.indexOf(element), kind: 'name', value: name };
	}

	return { index: elements.indexOf(element), kind: 'index' };
};

const resolveLocator = (locator: ElementLocator, selector: string) => {
	if (locator.kind === 'id') {
		return document.getElementById(locator.value) ?? undefined;
	}
	if (locator.kind === 'name') {
		return [...document.querySelectorAll(selector)].filter(
			(element) => element.getAttribute('name') === locator.value
		)[locator.index];
	}

	return document.querySelectorAll(selector)[locator.index];
};

const shouldCaptureControl = (element: Element) => {
	if (element.closest('[data-absolute-navigation-preserve="off"]'))
		return false;
	if (!(element instanceof HTMLInputElement)) return true;
	if (
		element.type === 'file' ||
		element.type === 'hidden' ||
		element.type === 'password'
	)
		return false;

	return !SENSITIVE_AUTOCOMPLETE.has(element.autocomplete.toLowerCase());
};

const captureControl = (element: Element, locator: ElementLocator) => {
	const snapshot: ControlSnapshot = {
		locator,
		tag: element.tagName.toLowerCase()
	};
	if (element instanceof HTMLInputElement) {
		if (element.type === 'checkbox' || element.type === 'radio') {
			snapshot.checked = element.checked;
		} else {
			snapshot.value = element.value;
			if (element.selectionStart !== null)
				snapshot.selectionStart = element.selectionStart;
			if (element.selectionEnd !== null)
				snapshot.selectionEnd = element.selectionEnd;
		}
	} else if (element instanceof HTMLTextAreaElement) {
		snapshot.value = element.value;
		snapshot.selectionStart = element.selectionStart;
		snapshot.selectionEnd = element.selectionEnd;
	} else if (element instanceof HTMLSelectElement) {
		snapshot.values = [...element.selectedOptions].map(
			({ value }) => value
		);
	} else if (element instanceof HTMLDetailsElement) {
		snapshot.open = element.open;
	} else if (element.getAttribute('contenteditable') === 'true') {
		snapshot.value = element.textContent ?? '';
	}

	return snapshot;
};

const restoreControl = (snapshot: ControlSnapshot) => {
	const element = resolveLocator(snapshot.locator, CONTROL_SELECTOR);
	if (!element || element.tagName.toLowerCase() !== snapshot.tag) return;
	if (element instanceof HTMLInputElement) {
		if (snapshot.checked !== undefined) element.checked = snapshot.checked;
		else if (snapshot.value !== undefined) element.value = snapshot.value;
		if (
			snapshot.selectionStart !== undefined &&
			snapshot.selectionEnd !== undefined
		) {
			try {
				element.setSelectionRange(
					snapshot.selectionStart,
					snapshot.selectionEnd
				);
			} catch {
				// Input types without a text selection API still restore their value.
			}
		}
	} else if (element instanceof HTMLTextAreaElement) {
		if (snapshot.value !== undefined) element.value = snapshot.value;
		if (
			snapshot.selectionStart !== undefined &&
			snapshot.selectionEnd !== undefined
		)
			element.setSelectionRange(
				snapshot.selectionStart,
				snapshot.selectionEnd
			);
	} else if (element instanceof HTMLSelectElement && snapshot.values) {
		for (const option of element.options) {
			option.selected = snapshot.values.includes(option.value);
		}
	} else if (
		element instanceof HTMLDetailsElement &&
		snapshot.open !== undefined
	) {
		element.open = snapshot.open;
	} else if (
		element.getAttribute('contenteditable') === 'true' &&
		snapshot.value !== undefined
	) {
		element.textContent = snapshot.value;
	}
};

const focusElement = (element: Element | undefined) => {
	if (!(element instanceof HTMLElement)) return false;
	if (!element.matches(FOCUS_SELECTOR)) element.tabIndex = -1;
	element.focus({ preventScroll: true });

	return document.activeElement === element;
};

export const createAbsoluteMobileHistoryEntry = (
	path: string,
	index: number,
	entryId: string = crypto.randomUUID()
) =>
	({
		absoluteMobile: true,
		entryId,
		index,
		path
	}) satisfies AbsoluteMobileHistoryEntry;

export const readAbsoluteMobileHistoryEntry = (
	value: unknown
): AbsoluteMobileHistoryEntry | undefined => {
	if (typeof value !== 'object' || value === null) return undefined;
	if (
		Reflect.get(value, 'absoluteMobile') !== true ||
		typeof Reflect.get(value, 'entryId') !== 'string' ||
		!Number.isSafeInteger(Reflect.get(value, 'index')) ||
		typeof Reflect.get(value, 'path') !== 'string'
	)
		return undefined;

	return {
		absoluteMobile: true,
		entryId: Reflect.get(value, 'entryId'),
		index: Reflect.get(value, 'index'),
		path: Reflect.get(value, 'path')
	};
};

/** Captures route-local state in memory. Sensitive credential fields are omitted. */
export const captureAbsoluteMobileDocumentState =
	(): AbsoluteMobileDocumentSnapshot => {
		const controls = [
			...document.querySelectorAll(CONTROL_SELECTOR)
		].filter(shouldCaptureControl);
		const focusable = [...document.querySelectorAll(FOCUS_SELECTOR)];
		const scrollable = [...document.querySelectorAll(SCROLL_SELECTOR)];
		const active = document.activeElement;

		return {
			controls: controls.map((element) =>
				captureControl(element, locatorFor(element, controls))
			),
			...(active instanceof Element && focusable.includes(active)
				? { focus: locatorFor(active, focusable) }
				: {}),
			scroll: scrollable.map((element) => ({
				left: element.scrollLeft,
				locator: locatorFor(element, scrollable),
				top: element.scrollTop
			})),
			window: { x: window.scrollX, y: window.scrollY }
		};
	};

export const restoreAbsoluteMobileDocumentState = (
	snapshot: AbsoluteMobileDocumentSnapshot
) => {
	for (const control of snapshot.controls) restoreControl(control);
	const focus = snapshot.focus
		? resolveLocator(snapshot.focus, FOCUS_SELECTOR)
		: undefined;
	focusElement(focus);
	for (const scroll of snapshot.scroll) {
		const element = resolveLocator(scroll.locator, SCROLL_SELECTOR);
		if (element) element.scrollTo(scroll.left, scroll.top);
	}
	window.scrollTo(snapshot.window.x, snapshot.window.y);
};

export const resetAbsoluteMobileDocumentState = () => {
	for (const element of document.querySelectorAll(SCROLL_SELECTOR)) {
		element.scrollTo(0, 0);
	}
	window.scrollTo(0, 0);
	const autofocus = document.querySelector('[autofocus]');
	if (autofocus && focusElement(autofocus)) return;
	const target = ['[data-absolute-navigation-focus]', 'main h1', 'h1', 'main']
		.map((selector) => document.querySelector(selector))
		.find((element) => element !== null);
	focusElement(target ?? undefined);
};
