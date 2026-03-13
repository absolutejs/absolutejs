/* DOM state snapshot/restore to preserve user-visible state across HMR */

import type { DOMStateEntry, DOMStateSnapshot } from '../../../types/client';
import {
	FOCUS_ID_PREFIX_LENGTH,
	FOCUS_IDX_PREFIX_LENGTH,
	FOCUS_NAME_PREFIX_LENGTH,
	UNFOUND_INDEX
} from './constants';

const trySetSelectionRange = (
	element: HTMLInputElement | HTMLTextAreaElement,
	start: number,
	end: number
) => {
	try {
		element.setSelectionRange(start, end);
	} catch {
		/* ignore */
	}
};

const restoreSelectionRange = (
	element: HTMLInputElement | HTMLTextAreaElement,
	entry: DOMStateEntry
) => {
	if (
		entry.selStart === undefined ||
		entry.selEnd === undefined ||
		!element.setSelectionRange
	)
		return;
	trySetSelectionRange(element, entry.selStart, entry.selEnd);
};

const restoreInputEntry = (target: Element, entry: DOMStateEntry) => {
	if (!(target instanceof HTMLInputElement)) return;
	const input = target;
	const type = entry.type || input.getAttribute('type') || 'text';
	if (type === 'checkbox' || type === 'radio') {
		if (entry.checked !== undefined) input.checked = entry.checked;
	} else if (entry.value !== undefined) {
		input.value = entry.value;
	}
	restoreSelectionRange(input, entry);
};

const restoreTextareaEntry = (target: Element, entry: DOMStateEntry) => {
	if (!(target instanceof HTMLTextAreaElement)) return;
	const textarea = target;
	if (entry.value !== undefined) textarea.value = entry.value;
	restoreSelectionRange(textarea, entry);
};

const restoreSelectEntry = (target: Element, entry: DOMStateEntry) => {
	if (!Array.isArray(entry.values)) return;
	if (!(target instanceof HTMLSelectElement)) return;
	const select = target;
	const { values } = entry;
	Array.from(select.options).forEach((opt) => {
		opt.selected = values.indexOf(opt.value) !== UNFOUND_INDEX;
	});
};

const restoreEntry = (target: Element, entry: DOMStateEntry) => {
	if (target.tagName === 'INPUT') {
		restoreInputEntry(target, entry);

		return;
	}
	if (target.tagName === 'TEXTAREA') {
		restoreTextareaEntry(target, entry);

		return;
	}
	if (target.tagName === 'SELECT') {
		restoreSelectEntry(target, entry);

		return;
	}
	if (target.tagName === 'OPTION') {
		if (entry.selected !== undefined && target instanceof HTMLOptionElement)
			target.selected = entry.selected;

		return;
	}
	if (target.tagName === 'DETAILS') {
		if (entry.open !== undefined && target instanceof HTMLDetailsElement)
			target.open = entry.open;

		return;
	}
	if (target.getAttribute('contenteditable') === 'true') {
		if (entry.text !== undefined) target.textContent = entry.text;
	}
};

const findEntryTarget = (
	root: HTMLElement,
	elements: NodeListOf<Element>,
	entry: DOMStateEntry
) => {
	if (entry.id) return root.querySelector(`#${CSS.escape(entry.id)}`);
	if (entry.name)
		return root.querySelector(`[name="${CSS.escape(entry.name)}"]`);
	if (elements[entry.idx]) return elements[entry.idx] ?? null;

	return null;
};

const resolveFocusElement = (
	root: HTMLElement,
	elements: NodeListOf<Element>,
	activeKey: string
) => {
	if (activeKey.startsWith('id:'))
		return root.querySelector(
			`#${CSS.escape(activeKey.slice(FOCUS_ID_PREFIX_LENGTH))}`
		);
	if (activeKey.startsWith('name:'))
		return root.querySelector(
			`[name="${CSS.escape(activeKey.slice(FOCUS_NAME_PREFIX_LENGTH))}"]`
		);
	if (!activeKey.startsWith('idx:')) return null;
	const idx = parseInt(activeKey.slice(FOCUS_IDX_PREFIX_LENGTH), 10);
	if (isNaN(idx) || !elements[idx]) return null;

	return elements[idx];
};

export const restoreDOMState = (
	root: HTMLElement,
	snapshot: DOMStateSnapshot
) => {
	if (!snapshot || !snapshot.items) return;
	const selector =
		'input, textarea, select, option, [contenteditable="true"], details';
	const elements = root.querySelectorAll(selector);

	snapshot.items.forEach((entry) => {
		const target = findEntryTarget(root, elements, entry);
		if (!target) return;
		restoreEntry(target, entry);
	});

	if (!snapshot.activeKey) return;
	const focusEl = resolveFocusElement(root, elements, snapshot.activeKey);
	if (focusEl instanceof HTMLElement) {
		focusEl.focus();
	}
};

const resolveFormElement = (
	isStandalone: boolean,
	form: Element | null,
	name: string
) => {
	if (isStandalone) {
		const element: HTMLInputElement | null = document.querySelector(
			`input[name="${name}"], textarea[name="${name}"], select[name="${name}"]`
		);
		if (element) return element;

		const byId = document.getElementById(name);
		if (byId instanceof HTMLInputElement) return byId;

		return null;
	}
	if (!form) return null;

	const found = form.querySelector(`[name="${name}"], #${name}`);
	if (
		found instanceof HTMLInputElement ||
		found instanceof HTMLTextAreaElement ||
		found instanceof HTMLSelectElement
	)
		return found;

	return null;
};

const applyFormValue = (
	element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	value: boolean | string
) => {
	if (
		element instanceof HTMLInputElement &&
		(element.type === 'checkbox' || element.type === 'radio')
	) {
		element.checked = value === true;

		return;
	}
	element.value = String(value);
};

const resolveForm = (formId: string) => {
	const formIndex = parseInt(formId.replace('form-', ''));
	const form = document.getElementById(formId);
	if (form) return form;
	if (isNaN(formIndex)) return null;
	try {
		return document.querySelector(`form:nth-of-type(${formIndex + 1})`);
	} catch {
		return null;
	}
};

const restoreRadioGroup = (
	isStandalone: boolean,
	form: Element | null,
	groupName: string,
	selectedValue: string
) => {
	const scope = isStandalone ? document : form;
	if (!scope) return;

	const escapedName = CSS.escape(groupName);
	const escapedValue = CSS.escape(selectedValue);
	const radio = scope.querySelector<HTMLInputElement>(
		`input[type="radio"][name="${escapedName}"][value="${escapedValue}"]`
	);

	if (radio) {
		radio.checked = true;
	}
};

const RADIO_PREFIX = '__radio__';

export const restoreFormState = (
	formState: Record<string, Record<string, boolean | string>>
) => {
	Object.keys(formState).forEach((formId) => {
		const isStandalone = formId === '__standalone__';
		const form = isStandalone ? null : resolveForm(formId);
		const formData = formState[formId];
		if (!formData) return;
		Object.keys(formData).forEach((name) => {
			if (name.startsWith(RADIO_PREFIX)) {
				const groupName = name.slice(RADIO_PREFIX.length);
				const value = formData[name];
				if (value === undefined) return;
				restoreRadioGroup(isStandalone, form, groupName, String(value));

				return;
			}
			const element = resolveFormElement(isStandalone, form, name);
			if (!element) return;
			const value = formData[name];
			if (value === undefined) return;
			applyFormValue(element, value);
		});
	});
};

export const restoreScrollState = (scrollState: {
	window: { x: number; y: number };
}) => {
	if (scrollState && scrollState.window) {
		window.scrollTo(scrollState.window.x, scrollState.window.y);
	}
};

const saveInputEntry = (elem: Element, entry: DOMStateEntry) => {
	if (!(elem instanceof HTMLInputElement)) return;
	const input = elem;
	const type = input.getAttribute('type') || 'text';
	entry.type = type;
	if (type === 'checkbox' || type === 'radio') {
		entry.checked = input.checked;
	} else {
		entry.value = input.value;
	}
	if (input.selectionStart !== null && input.selectionEnd !== null) {
		entry.selStart = input.selectionStart;
		entry.selEnd = input.selectionEnd;
	}
};

const saveTextareaEntry = (elem: Element, entry: DOMStateEntry) => {
	if (!(elem instanceof HTMLTextAreaElement)) return;
	const textarea = elem;
	entry.value = textarea.value;
	if (textarea.selectionStart !== null && textarea.selectionEnd !== null) {
		entry.selStart = textarea.selectionStart;
		entry.selEnd = textarea.selectionEnd;
	}
};

const saveSelectEntry = (elem: Element, entry: DOMStateEntry) => {
	if (!(elem instanceof HTMLSelectElement)) return;
	const select = elem;
	const vals: string[] = [];
	Array.from(select.options).forEach((opt) => {
		if (opt.selected) vals.push(opt.value);
	});
	entry.values = vals;
};

const saveElementEntry = (elem: Element, entry: DOMStateEntry) => {
	if (elem.tagName === 'INPUT') {
		saveInputEntry(elem, entry);

		return;
	}
	if (elem.tagName === 'TEXTAREA') {
		saveTextareaEntry(elem, entry);

		return;
	}
	if (elem.tagName === 'SELECT') {
		saveSelectEntry(elem, entry);

		return;
	}
	if (elem.tagName === 'OPTION') {
		if (elem instanceof HTMLOptionElement) entry.selected = elem.selected;

		return;
	}
	if (elem.tagName === 'DETAILS') {
		if (elem instanceof HTMLDetailsElement) entry.open = elem.open;

		return;
	}
	if (elem.getAttribute('contenteditable') === 'true') {
		entry.text = elem.textContent || undefined;
	}
};

export const saveDOMState = (root: HTMLElement) => {
	const snapshot: DOMStateSnapshot = { activeKey: null, items: [] };
	const selector =
		'input, textarea, select, option, [contenteditable="true"], details';
	const elements = root.querySelectorAll(selector);

	elements.forEach((el, idx) => {
		const entry: DOMStateEntry = {
			idx,
			tag: el.tagName.toLowerCase()
		};
		const id = el.getAttribute('id');
		const name = el.getAttribute('name');
		if (id) entry.id = id;
		else if (name) entry.name = name;
		saveElementEntry(el, entry);
		snapshot.items.push(entry);
	});

	const active = document.activeElement;
	if (!active || !root.contains(active)) return snapshot;
	const id = active.getAttribute('id');
	const name = active.getAttribute('name');
	if (id) snapshot.activeKey = `id:${id}`;
	else if (name) snapshot.activeKey = `name:${name}`;
	else
		snapshot.activeKey = `idx:${Array.prototype.indexOf.call(elements, active)}`;

	return snapshot;
};

const collectInputState = (
	element: HTMLInputElement,
	name: string,
	target: Record<string, boolean | string>
) => {
	if (element.type === 'radio') {
		if (element.checked) target[`__radio__${name}`] = element.value;

		return;
	}
	if (element.type === 'checkbox') {
		target[name] = element.checked;

		return;
	}
	target[name] = element.value;
};

export const saveFormState = () => {
	const formState: Record<string, Record<string, boolean | string>> = {};
	const forms = document.querySelectorAll('form');
	forms.forEach((form, formIndex) => {
		const formId = form.id || `form-${formIndex}`;
		const formData: Record<string, boolean | string> = {};
		formState[formId] = formData;
		const inputs = form.querySelectorAll('input, textarea, select');
		inputs.forEach((input) => {
			if (!(input instanceof HTMLInputElement)) return;
			const name =
				input.name || input.id || `input-${formIndex}-${inputs.length}`;
			collectInputState(input, name, formData);
		});
	});

	const standaloneInputs = document.querySelectorAll(
		'input:not(form input), textarea:not(form textarea), select:not(form select)'
	);
	if (standaloneInputs.length <= 0) return formState;
	const standaloneData: Record<string, boolean | string> = {};
	formState['__standalone__'] = standaloneData;
	standaloneInputs.forEach((input) => {
		if (!(input instanceof HTMLInputElement)) return;
		const name =
			input.name || input.id || `standalone-${standaloneInputs.length}`;
		collectInputState(input, name, standaloneData);
	});

	return formState;
};

export const saveScrollState = () => {
	const scrollX = window.scrollX || window.pageXOffset;
	const scrollY = window.scrollY || window.pageYOffset;

	return {
		window: { x: scrollX, y: scrollY }
	};
};
