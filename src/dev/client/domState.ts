/* DOM state snapshot/restore to preserve user-visible state across HMR */

import type { DOMStateEntry, DOMStateSnapshot } from '../../../types/client';

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
	const input = target as HTMLInputElement;
	const type = entry.type || input.getAttribute('type') || 'text';
	if (type === 'checkbox' || type === 'radio') {
		if (entry.checked !== undefined) input.checked = entry.checked;
	} else if (entry.value !== undefined) {
		input.value = entry.value;
	}
	restoreSelectionRange(input, entry);
};

const restoreTextareaEntry = (target: Element, entry: DOMStateEntry) => {
	const textarea = target as HTMLTextAreaElement;
	if (entry.value !== undefined) textarea.value = entry.value;
	restoreSelectionRange(textarea, entry);
};

const restoreSelectEntry = (target: Element, entry: DOMStateEntry) => {
	if (!Array.isArray(entry.values)) return;
	const select = target as HTMLSelectElement;
	Array.from(select.options).forEach((opt) => {
		opt.selected = entry.values!.indexOf(opt.value) !== -1;
	});
};

const restoreEntry = (target: Element, entry: DOMStateEntry) => {
	if (target.tagName === 'INPUT') return restoreInputEntry(target, entry);
	if (target.tagName === 'TEXTAREA')
		return restoreTextareaEntry(target, entry);
	if (target.tagName === 'SELECT') return restoreSelectEntry(target, entry);
	if (target.tagName === 'OPTION') {
		if (entry.selected !== undefined)
			(target as HTMLOptionElement).selected = entry.selected;

		return;
	}
	if (target.tagName === 'DETAILS') {
		if (entry.open !== undefined)
			(target as HTMLDetailsElement).open = entry.open;

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
	if (elements[entry.idx]) return elements[entry.idx]!;

	return null;
};

const resolveFocusElement = (
	root: HTMLElement,
	elements: NodeListOf<Element>,
	activeKey: string
) => {
	if (activeKey.startsWith('id:'))
		return root.querySelector(`#${CSS.escape(activeKey.slice(3))}`);
	if (activeKey.startsWith('name:'))
		return root.querySelector(`[name="${CSS.escape(activeKey.slice(5))}"]`);
	if (!activeKey.startsWith('idx:')) return null;
	const idx = parseInt(activeKey.slice(4), 10);
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
	if (focusEl && (focusEl as HTMLElement).focus) {
		(focusEl as HTMLElement).focus();
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

		return document.getElementById(name) as HTMLInputElement | null;
	}
	if (!form) return null;

	return form.querySelector(`[name="${name}"], #${name}`);
};

const applyFormValue = (element: HTMLInputElement, value: boolean | string) => {
	if (element.type === 'checkbox' || element.type === 'radio') {
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
	} catch (_e) {
		return null;
	}
};

export const restoreFormState = (
	formState: Record<string, Record<string, boolean | string>>
) => {
	Object.keys(formState).forEach((formId) => {
		const isStandalone = formId === '__standalone__';
		const form = isStandalone ? null : resolveForm(formId);
		Object.keys(formState[formId]!).forEach((name) => {
			const element = resolveFormElement(isStandalone, form, name);
			if (!element) return;
			applyFormValue(element, formState[formId]![name]!);
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

const saveInputEntry = (el: Element, entry: DOMStateEntry) => {
	const input = el as HTMLInputElement;
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

const saveTextareaEntry = (el: Element, entry: DOMStateEntry) => {
	const textarea = el as HTMLTextAreaElement;
	entry.value = textarea.value;
	if (textarea.selectionStart !== null && textarea.selectionEnd !== null) {
		entry.selStart = textarea.selectionStart;
		entry.selEnd = textarea.selectionEnd;
	}
};

const saveSelectEntry = (el: Element, entry: DOMStateEntry) => {
	const select = el as HTMLSelectElement;
	const vals: string[] = [];
	Array.from(select.options).forEach((opt) => {
		if (opt.selected) vals.push(opt.value);
	});
	entry.values = vals;
};

const saveElementEntry = (el: Element, entry: DOMStateEntry) => {
	if (el.tagName === 'INPUT') return saveInputEntry(el, entry);
	if (el.tagName === 'TEXTAREA') return saveTextareaEntry(el, entry);
	if (el.tagName === 'SELECT') return saveSelectEntry(el, entry);
	if (el.tagName === 'OPTION') {
		entry.selected = (el as HTMLOptionElement).selected;

		return;
	}
	if (el.tagName === 'DETAILS') {
		entry.open = (el as HTMLDetailsElement).open;

		return;
	}
	if (el.getAttribute('contenteditable') === 'true') {
		entry.text = el.textContent || undefined;
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
	if (element.type === 'checkbox' || element.type === 'radio') {
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
		formState[formId] = {};
		const inputs = form.querySelectorAll('input, textarea, select');
		inputs.forEach((input) => {
			const element = input as HTMLInputElement;
			const name =
				element.name ||
				element.id ||
				`input-${formIndex}-${inputs.length}`;
			collectInputState(element, name, formState[formId]!);
		});
	});

	const standaloneInputs = document.querySelectorAll(
		'input:not(form input), textarea:not(form textarea), select:not(form select)'
	);
	if (standaloneInputs.length <= 0) return formState;
	formState['__standalone__'] = {};
	standaloneInputs.forEach((input) => {
		const element = input as HTMLInputElement;
		const name =
			element.name ||
			element.id ||
			`standalone-${standaloneInputs.length}`;
		collectInputState(element, name, formState['__standalone__']!);
	});

	return formState;
};

export const saveScrollState = () => ({
	window: {
		x: window.scrollX || window.pageXOffset,
		y: window.scrollY || window.pageYOffset
	}
});
