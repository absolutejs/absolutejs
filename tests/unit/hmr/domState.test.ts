import { afterEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Preserve Bun's native fetch before happy-dom overwrites it
const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;

GlobalRegistrator.register();

// Restore native fetch so integration tests using fetch() don't get CORS errors
globalThis.fetch = nativeFetch;
globalThis.Request = nativeRequest;
globalThis.Response = nativeResponse;
globalThis.Headers = nativeHeaders;

import {
	saveDOMState,
	restoreDOMState,
	saveFormState,
	restoreFormState,
	saveScrollState,
	restoreScrollState
} from '../../../src/dev/client/domState';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('saveDOMState + restoreDOMState roundtrip', () => {
	test('preserves text input value', () => {
		document.body.innerHTML =
			'<div id="root"><input type="text" id="txt" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		const input = document.getElementById('txt') as HTMLInputElement;
		input.value = 'hello world';

		const snapshot = saveDOMState(root);
		input.value = '';
		restoreDOMState(root, snapshot);

		expect((document.getElementById('txt') as HTMLInputElement).value).toBe(
			'hello world'
		);
	});

	test('preserves checkbox checked state', () => {
		document.body.innerHTML =
			'<div id="root"><input type="checkbox" id="cb" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		const cb = document.getElementById('cb') as HTMLInputElement;
		cb.checked = true;

		const snapshot = saveDOMState(root);
		cb.checked = false;
		restoreDOMState(root, snapshot);

		expect(
			(document.getElementById('cb') as HTMLInputElement).checked
		).toBe(true);
	});

	test('preserves radio button selection', () => {
		document.body.innerHTML = `
			<div id="root">
				<input type="radio" name="color" id="r1" value="red" />
				<input type="radio" name="color" id="r2" value="blue" />
			</div>`;
		const root = document.getElementById('root') as HTMLElement;
		const r1 = document.getElementById('r1') as HTMLInputElement;
		r1.checked = true;

		const snapshot = saveDOMState(root);
		r1.checked = false;
		(document.getElementById('r2') as HTMLInputElement).checked = true;
		restoreDOMState(root, snapshot);

		expect(
			(document.getElementById('r1') as HTMLInputElement).checked
		).toBe(true);
	});

	test('preserves textarea value', () => {
		document.body.innerHTML =
			'<div id="root"><textarea id="ta"></textarea></div>';
		const root = document.getElementById('root') as HTMLElement;
		const ta = document.getElementById('ta') as HTMLTextAreaElement;
		ta.value = 'some text\nwith newlines';

		const snapshot = saveDOMState(root);
		ta.value = '';
		restoreDOMState(root, snapshot);

		expect(
			(document.getElementById('ta') as HTMLTextAreaElement).value
		).toBe('some text\nwith newlines');
	});

	test('preserves single select value', () => {
		document.body.innerHTML = `
			<div id="root">
				<select id="sel">
					<option value="a">A</option>
					<option value="b">B</option>
					<option value="c">C</option>
				</select>
			</div>`;
		const root = document.getElementById('root') as HTMLElement;
		const sel = document.getElementById('sel') as HTMLSelectElement;
		sel.value = 'b';

		const snapshot = saveDOMState(root);
		sel.value = 'a';
		restoreDOMState(root, snapshot);

		expect(
			(document.getElementById('sel') as HTMLSelectElement).value
		).toBe('b');
	});

	test('preserves multiple select values', () => {
		document.body.innerHTML = `
			<div id="root">
				<select id="msel" multiple>
					<option value="x">X</option>
					<option value="y">Y</option>
					<option value="z">Z</option>
				</select>
			</div>`;
		const root = document.getElementById('root') as HTMLElement;
		const sel = document.getElementById('msel') as HTMLSelectElement;
		(sel.options[0] as HTMLOptionElement).selected = true;
		(sel.options[2] as HTMLOptionElement).selected = true;

		const snapshot = saveDOMState(root);
		(sel.options[0] as HTMLOptionElement).selected = false;
		(sel.options[1] as HTMLOptionElement).selected = true;
		(sel.options[2] as HTMLOptionElement).selected = false;
		restoreDOMState(root, snapshot);

		const opts = (document.getElementById('msel') as HTMLSelectElement)
			.options;
		expect((opts[0] as HTMLOptionElement).selected).toBe(true);
		expect((opts[1] as HTMLOptionElement).selected).toBe(false);
		expect((opts[2] as HTMLOptionElement).selected).toBe(true);
	});

	test('preserves details open state', () => {
		document.body.innerHTML = `
			<div id="root">
				<details id="det"><summary>Info</summary><p>Content</p></details>
			</div>`;
		const root = document.getElementById('root') as HTMLElement;
		const det = document.getElementById('det') as HTMLDetailsElement;
		det.open = true;

		const snapshot = saveDOMState(root);
		det.open = false;
		restoreDOMState(root, snapshot);

		expect(
			(document.getElementById('det') as HTMLDetailsElement).open
		).toBe(true);
	});

	test('preserves contenteditable text', () => {
		document.body.innerHTML =
			'<div id="root"><div contenteditable="true" id="ce">editable</div></div>';
		const root = document.getElementById('root') as HTMLElement;
		const ce = document.getElementById('ce') as HTMLElement;
		ce.textContent = 'modified text';

		const snapshot = saveDOMState(root);
		ce.textContent = '';
		restoreDOMState(root, snapshot);

		expect((document.getElementById('ce') as HTMLElement).textContent).toBe(
			'modified text'
		);
	});

	test('tracks focused element by id', () => {
		document.body.innerHTML =
			'<div id="root"><input id="f1" /><input id="f2" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		(document.getElementById('f1') as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		expect(snapshot.activeKey).toBe('id:f1');
	});

	test('tracks focused element by name', () => {
		document.body.innerHTML =
			'<div id="root"><input name="username" /><input name="email" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		(root.querySelector('[name="username"]') as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		expect(snapshot.activeKey).toBe('name:username');
	});

	test('tracks focused element by index', () => {
		document.body.innerHTML =
			'<div id="root"><input /><input /><input /></div>';
		const root = document.getElementById('root') as HTMLElement;
		const inputs = root.querySelectorAll('input');
		(inputs[1] as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		expect(snapshot.activeKey).toBe('idx:1');
	});

	test('restores focus by id', () => {
		document.body.innerHTML =
			'<div id="root"><input id="f1" /><input id="f2" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		(document.getElementById('f1') as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		(document.getElementById('f2') as HTMLElement).focus();
		restoreDOMState(root, snapshot);

		expect(document.activeElement).toBe(document.getElementById('f1'));
	});

	test('restores focus by name', () => {
		document.body.innerHTML =
			'<div id="root"><input name="first" /><input name="second" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		(root.querySelector('[name="first"]') as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		(root.querySelector('[name="second"]') as HTMLElement).focus();
		restoreDOMState(root, snapshot);

		expect(document.activeElement).toBe(
			root.querySelector('[name="first"]')
		);
	});

	test('restores focus by index', () => {
		document.body.innerHTML =
			'<div id="root"><input /><input /><input /></div>';
		const root = document.getElementById('root') as HTMLElement;
		const inputs = root.querySelectorAll('input');
		(inputs[2] as HTMLElement).focus();

		const snapshot = saveDOMState(root);
		(inputs[0] as HTMLElement).focus();
		restoreDOMState(root, snapshot);

		expect(document.activeElement).toBe(inputs[2]);
	});

	test('handles empty root element', () => {
		document.body.innerHTML = '<div id="root"></div>';
		const root = document.getElementById('root') as HTMLElement;

		const snapshot = saveDOMState(root);
		expect(snapshot.items).toEqual([]);
		expect(snapshot.activeKey).toBeNull();
	});

	test('handles null/invalid snapshot gracefully', () => {
		document.body.innerHTML =
			'<div id="root"><input id="i" value="original" /></div>';
		const root = document.getElementById('root') as HTMLElement;

		restoreDOMState(
			root,
			null as unknown as Parameters<typeof restoreDOMState>[1]
		);
		restoreDOMState(root, { activeKey: null, items: [] });

		expect((document.getElementById('i') as HTMLInputElement).value).toBe(
			'original'
		);
	});

	test('finds elements by name fallback when id is absent', () => {
		document.body.innerHTML =
			'<div id="root"><input name="field1" /></div>';
		const root = document.getElementById('root') as HTMLElement;
		const input = root.querySelector('[name="field1"]') as HTMLInputElement;
		input.value = 'via name';

		const snapshot = saveDOMState(root);
		expect(snapshot.items[0]?.name).toBe('field1');

		input.value = '';
		restoreDOMState(root, snapshot);

		expect(
			(root.querySelector('[name="field1"]') as HTMLInputElement).value
		).toBe('via name');
	});
});

describe('saveFormState + restoreFormState', () => {
	test('saves and restores form with named text input', () => {
		document.body.innerHTML = `
			<form id="myform">
				<input name="username" type="text" value="" />
			</form>`;
		const input = document.querySelector(
			'[name="username"]'
		) as HTMLInputElement;
		input.value = 'testuser';

		const state = saveFormState();
		input.value = '';
		restoreFormState(state);

		expect(
			(document.querySelector('[name="username"]') as HTMLInputElement)
				.value
		).toBe('testuser');
	});

	test('saves and restores checkbox in form', () => {
		document.body.innerHTML = `
			<form id="settings">
				<input name="notify" type="checkbox" />
			</form>`;
		const cb = document.querySelector(
			'[name="notify"]'
		) as HTMLInputElement;
		cb.checked = true;

		const state = saveFormState();
		cb.checked = false;
		restoreFormState(state);

		expect(
			(document.querySelector('[name="notify"]') as HTMLInputElement)
				.checked
		).toBe(true);
	});

	test('saves and restores radio group with __radio__ prefix', () => {
		document.body.innerHTML = `
			<form id="survey">
				<input type="radio" name="answer" value="yes" />
				<input type="radio" name="answer" value="no" />
			</form>`;
		const yes = document.querySelector('[value="yes"]') as HTMLInputElement;
		yes.checked = true;

		const state = saveFormState();
		expect(state['survey']?.['__radio__answer']).toBe('yes');

		yes.checked = false;
		(document.querySelector('[value="no"]') as HTMLInputElement).checked =
			true;
		restoreFormState(state);

		expect(
			(document.querySelector('[value="yes"]') as HTMLInputElement)
				.checked
		).toBe(true);
	});

	test('saves and restores standalone inputs', () => {
		document.body.innerHTML = '<input name="solo" type="text" value="" />';
		const input = document.querySelector(
			'[name="solo"]'
		) as HTMLInputElement;
		input.value = 'standalone value';

		const state = saveFormState();
		expect(state['__standalone__']).toBeDefined();
		expect(state['__standalone__']?.['solo']).toBe('standalone value');

		input.value = '';
		restoreFormState(state);

		expect(
			(document.querySelector('[name="solo"]') as HTMLInputElement).value
		).toBe('standalone value');
	});

	test('handles multiple forms on page', () => {
		document.body.innerHTML = `
			<form id="form-a"><input name="a" type="text" /></form>
			<form id="form-b"><input name="b" type="text" /></form>`;
		(document.querySelector('[name="a"]') as HTMLInputElement).value =
			'alpha';
		(document.querySelector('[name="b"]') as HTMLInputElement).value =
			'beta';

		const state = saveFormState();
		expect(state['form-a']?.['a']).toBe('alpha');
		expect(state['form-b']?.['b']).toBe('beta');

		(document.querySelector('[name="a"]') as HTMLInputElement).value = '';
		(document.querySelector('[name="b"]') as HTMLInputElement).value = '';
		restoreFormState(state);

		expect(
			(document.querySelector('[name="a"]') as HTMLInputElement).value
		).toBe('alpha');
		expect(
			(document.querySelector('[name="b"]') as HTMLInputElement).value
		).toBe('beta');
	});

	test('forms without id use form-{index} key', () => {
		document.body.innerHTML = '<form><input name="x" type="text" /></form>';
		(document.querySelector('[name="x"]') as HTMLInputElement).value =
			'indexed';

		const state = saveFormState();
		expect(state['form-0']).toBeDefined();
		expect(state['form-0']?.['x']).toBe('indexed');
	});

	test('returns empty object when no forms or standalone inputs exist', () => {
		document.body.innerHTML = '<div>no forms here</div>';

		const state = saveFormState();
		expect(Object.keys(state)).toEqual([]);
	});
});

describe('saveScrollState + restoreScrollState', () => {
	test('saves current window scroll position', () => {
		const state = saveScrollState();
		expect(state.window).toBeDefined();
		expect(typeof state.window.x).toBe('number');
		expect(typeof state.window.y).toBe('number');
	});

	test('calls window.scrollTo on restore', () => {
		const calls: Array<{ x: number; y: number }> = [];
		const originalScrollTo = window.scrollTo.bind(window);
		window.scrollTo = ((x: number, y: number) => {
			calls.push({ x, y });
		}) as typeof window.scrollTo;

		restoreScrollState({ window: { x: 100, y: 200 } });

		expect(calls.length).toBe(1);
		expect(calls[0]).toEqual({ x: 100, y: 200 });

		window.scrollTo = originalScrollTo;
	});

	test('handles zero scroll values', () => {
		const calls: Array<{ x: number; y: number }> = [];
		const originalScrollTo = window.scrollTo.bind(window);
		window.scrollTo = ((x: number, y: number) => {
			calls.push({ x, y });
		}) as typeof window.scrollTo;

		restoreScrollState({ window: { x: 0, y: 0 } });

		expect(calls.length).toBe(1);
		expect(calls[0]).toEqual({ x: 0, y: 0 });

		window.scrollTo = originalScrollTo;
	});
});
