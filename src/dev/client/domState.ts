/* DOM state snapshot/restore to preserve user-visible state across HMR */

import type { DOMStateEntry, DOMStateSnapshot } from './types';

export function saveDOMState(root: HTMLElement): DOMStateSnapshot {
	const snapshot: DOMStateSnapshot = { activeKey: null, items: [] };
	const selector =
		'input, textarea, select, option, [contenteditable="true"], details';
	const elements = root.querySelectorAll(selector);

	elements.forEach(function (el, idx) {
		const entry: DOMStateEntry = {
			idx,
			tag: el.tagName.toLowerCase()
		};
		const id = el.getAttribute('id');
		const name = el.getAttribute('name');
		if (id) entry.id = id;
		else if (name) entry.name = name;

		if (el.tagName === 'INPUT') {
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
		} else if (el.tagName === 'TEXTAREA') {
			const textarea = el as HTMLTextAreaElement;
			entry.value = textarea.value;
			if (
				textarea.selectionStart !== null &&
				textarea.selectionEnd !== null
			) {
				entry.selStart = textarea.selectionStart;
				entry.selEnd = textarea.selectionEnd;
			}
		} else if (el.tagName === 'SELECT') {
			const select = el as HTMLSelectElement;
			const vals: string[] = [];
			Array.from(select.options).forEach(function (opt) {
				if (opt.selected) vals.push(opt.value);
			});
			entry.values = vals;
		} else if (el.tagName === 'OPTION') {
			entry.selected = (el as HTMLOptionElement).selected;
		} else if (el.tagName === 'DETAILS') {
			entry.open = (el as HTMLDetailsElement).open;
		} else if (el.getAttribute('contenteditable') === 'true') {
			entry.text = el.textContent || undefined;
		}
		snapshot.items.push(entry);
	});

	const active = document.activeElement;
	if (active && root.contains(active)) {
		const id = active.getAttribute('id');
		const name = active.getAttribute('name');
		if (id) snapshot.activeKey = 'id:' + id;
		else if (name) snapshot.activeKey = 'name:' + name;
		else
			snapshot.activeKey =
				'idx:' + Array.prototype.indexOf.call(elements, active);
	}
	return snapshot;
}

export function restoreDOMState(
	root: HTMLElement,
	snapshot: DOMStateSnapshot
): void {
	if (!snapshot || !snapshot.items) return;
	const selector =
		'input, textarea, select, option, [contenteditable="true"], details';
	const elements = root.querySelectorAll(selector);

	snapshot.items.forEach(function (entry) {
		let target: Element | null = null;
		if (entry.id) {
			target = root.querySelector('#' + CSS.escape(entry.id));
		}
		if (!target && entry.name) {
			target = root.querySelector(
				'[name="' + CSS.escape(entry.name) + '"]'
			);
		}
		if (!target && elements[entry.idx]) {
			target = elements[entry.idx]!;
		}
		if (!target) return;

		if (target.tagName === 'INPUT') {
			const input = target as HTMLInputElement;
			const type = entry.type || input.getAttribute('type') || 'text';
			if (type === 'checkbox' || type === 'radio') {
				if (entry.checked !== undefined) input.checked = entry.checked;
			} else if (entry.value !== undefined) {
				input.value = entry.value;
			}
			if (
				entry.selStart !== undefined &&
				entry.selEnd !== undefined &&
				input.setSelectionRange
			) {
				try {
					input.setSelectionRange(entry.selStart, entry.selEnd);
				} catch {
					/* ignore */
				}
			}
		} else if (target.tagName === 'TEXTAREA') {
			const textarea = target as HTMLTextAreaElement;
			if (entry.value !== undefined) textarea.value = entry.value;
			if (
				entry.selStart !== undefined &&
				entry.selEnd !== undefined &&
				textarea.setSelectionRange
			) {
				try {
					textarea.setSelectionRange(entry.selStart, entry.selEnd);
				} catch {
					/* ignore */
				}
			}
		} else if (target.tagName === 'SELECT') {
			if (Array.isArray(entry.values)) {
				const select = target as HTMLSelectElement;
				Array.from(select.options).forEach(function (opt) {
					opt.selected = entry.values!.indexOf(opt.value) !== -1;
				});
			}
		} else if (target.tagName === 'OPTION') {
			if (entry.selected !== undefined)
				(target as HTMLOptionElement).selected = entry.selected;
		} else if (target.tagName === 'DETAILS') {
			if (entry.open !== undefined)
				(target as HTMLDetailsElement).open = entry.open;
		} else if (target.getAttribute('contenteditable') === 'true') {
			if (entry.text !== undefined) target.textContent = entry.text;
		}
	});

	if (snapshot.activeKey) {
		let focusEl: Element | null = null;
		if (snapshot.activeKey.startsWith('id:')) {
			focusEl = root.querySelector(
				'#' + CSS.escape(snapshot.activeKey.slice(3))
			);
		} else if (snapshot.activeKey.startsWith('name:')) {
			focusEl = root.querySelector(
				'[name="' + CSS.escape(snapshot.activeKey.slice(5)) + '"]'
			);
		} else if (snapshot.activeKey.startsWith('idx:')) {
			const idx = parseInt(snapshot.activeKey.slice(4), 10);
			if (!isNaN(idx) && elements[idx]) focusEl = elements[idx]!;
		}
		if (focusEl && (focusEl as HTMLElement).focus) {
			(focusEl as HTMLElement).focus();
		}
	}
}

export function saveFormState(): Record<
	string,
	Record<string, boolean | string>
> {
	const formState: Record<string, Record<string, boolean | string>> = {};
	const forms = document.querySelectorAll('form');
	forms.forEach(function (form, formIndex) {
		const formId = form.id || 'form-' + formIndex;
		formState[formId] = {};
		const inputs = form.querySelectorAll('input, textarea, select');
		inputs.forEach(function (input) {
			const element = input as HTMLInputElement;
			const name =
				element.name ||
				element.id ||
				'input-' + formIndex + '-' + inputs.length;
			if (element.type === 'checkbox' || element.type === 'radio') {
				formState[formId]![name] = element.checked;
			} else {
				formState[formId]![name] = element.value;
			}
		});
	});

	const standaloneInputs = document.querySelectorAll(
		'input:not(form input), textarea:not(form textarea), select:not(form select)'
	);
	if (standaloneInputs.length > 0) {
		formState['__standalone__'] = {};
		standaloneInputs.forEach(function (input) {
			const element = input as HTMLInputElement;
			const name =
				element.name ||
				element.id ||
				'standalone-' + standaloneInputs.length;
			if (element.type === 'checkbox' || element.type === 'radio') {
				formState['__standalone__']![name] = element.checked;
			} else {
				formState['__standalone__']![name] = element.value;
			}
		});
	}
	return formState;
}

export function restoreFormState(
	formState: Record<string, Record<string, boolean | string>>
): void {
	Object.keys(formState).forEach(function (formId) {
		const isStandalone = formId === '__standalone__';
		const form = isStandalone
			? null
			: document.getElementById(formId) ||
				document.querySelector(
					'form:nth-of-type(' +
						(parseInt(formId.replace('form-', '')) + 1) +
						')'
				);
		Object.keys(formState[formId]!).forEach(function (name) {
			let element: HTMLInputElement | null = null;
			if (isStandalone) {
				element = document.querySelector(
					'input[name="' +
						name +
						'"], textarea[name="' +
						name +
						'"], select[name="' +
						name +
						'"]'
				);
				if (!element) {
					element = document.getElementById(
						name
					) as HTMLInputElement | null;
				}
			} else if (form) {
				element = form.querySelector('[name="' + name + '"], #' + name);
			}
			if (element) {
				const value = formState[formId]![name]!;
				if (element.type === 'checkbox' || element.type === 'radio') {
					element.checked = value === true;
				} else {
					element.value = String(value);
				}
			}
		});
	});
}

export function saveScrollState(): { window: { x: number; y: number } } {
	return {
		window: {
			x: window.scrollX || window.pageXOffset,
			y: window.scrollY || window.pageYOffset
		}
	};
}

export function restoreScrollState(scrollState: {
	window: { x: number; y: number };
}): void {
	if (scrollState && scrollState.window) {
		window.scrollTo(scrollState.window.x, scrollState.window.y);
	}
}
