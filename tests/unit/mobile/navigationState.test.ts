import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test
} from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	captureAbsoluteMobileDocumentState,
	createAbsoluteMobileHistoryEntry,
	readAbsoluteMobileHistoryEntry,
	resetAbsoluteMobileDocumentState,
	restoreAbsoluteMobileDocumentState
} from '../../../src/mobile/navigationState';

beforeAll(() =>
	GlobalRegistrator.register({ url: 'https://example.com/account' })
);
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
	document.documentElement.replaceChildren(
		document.createElement('head'),
		document.createElement('body')
	);
	window.scrollTo(0, 0);
});

const renderForm = () => {
	document.body.innerHTML = `
		<main data-absolute-app-main>
			<h1 id="title">Account</h1>
			<input id="name" value="server">
			<input id="secret" type="password" value="do-not-retain">
			<input id="otp" autocomplete="one-time-code" value="123456">
			<input id="ignored" data-absolute-navigation-preserve="off" value="ignore">
			<textarea id="bio">server bio</textarea>
			<select id="roles" multiple>
				<option value="admin">Admin</option>
				<option value="member">Member</option>
			</select>
			<details id="advanced"><summary>Advanced</summary></details>
		</main>
	`;
};

describe('mobile navigation state', () => {
	test('round-trips typed history entries and rejects unrelated state', () => {
		const entry = createAbsoluteMobileHistoryEntry(
			'/account',
			3,
			'entry-3'
		);

		expect(readAbsoluteMobileHistoryEntry(entry)).toEqual(entry);
		expect(
			readAbsoluteMobileHistoryEntry({ absoluteMobile: true })
		).toBeUndefined();
		expect(readAbsoluteMobileHistoryEntry(null)).toBeUndefined();
	});

	test('restores form, focus, selection, disclosure, and scroll state', () => {
		renderForm();
		const main = document.querySelector('main');
		const name = document.getElementById('name');
		const bio = document.getElementById('bio');
		const roles = document.getElementById('roles');
		const details = document.getElementById('advanced');
		if (!(main instanceof HTMLElement)) throw new TypeError('main');
		if (!(name instanceof HTMLInputElement)) throw new TypeError('name');
		if (!(bio instanceof HTMLTextAreaElement)) throw new TypeError('bio');
		if (!(roles instanceof HTMLSelectElement)) throw new TypeError('roles');
		if (!(details instanceof HTMLDetailsElement))
			throw new TypeError('details');
		name.value = 'Ada';
		name.focus();
		name.setSelectionRange(1, 2);
		bio.value = 'local bio';
		const [, member] = roles.options;
		if (!member) throw new TypeError('member option');
		member.selected = true;
		details.open = true;
		main.scrollTop = 240;
		const snapshot = captureAbsoluteMobileDocumentState();

		renderForm();
		restoreAbsoluteMobileDocumentState(snapshot);

		expect(
			(document.getElementById('name') as HTMLInputElement).value
		).toBe('Ada');
		expect(
			(document.getElementById('name') as HTMLInputElement).selectionStart
		).toBe(1);
		expect(
			(document.getElementById('bio') as HTMLTextAreaElement).value
		).toBe('local bio');
		expect(
			(document.getElementById('roles') as HTMLSelectElement)
				.selectedOptions[0]?.value
		).toBe('member');
		expect(
			(document.getElementById('advanced') as HTMLDetailsElement).open
		).toBe(true);
		expect(document.activeElement?.id).toBe('name');
		expect(document.querySelector('main')?.scrollTop).toBe(240);
	});

	test('never captures credential, one-time-code, or opted-out values', () => {
		renderForm();
		const snapshot = captureAbsoluteMobileDocumentState();
		const serialized = JSON.stringify(snapshot);

		expect(serialized).not.toContain('do-not-retain');
		expect(serialized).not.toContain('123456');
		expect(serialized).not.toContain('ignore');
	});

	test('resets a new route to the top and focuses its semantic heading', () => {
		renderForm();
		const main = document.querySelector('main');
		if (!(main instanceof HTMLElement)) throw new TypeError('main');
		main.scrollTop = 200;

		resetAbsoluteMobileDocumentState();

		expect(main.scrollTop).toBe(0);
		expect(document.activeElement?.id).toBe('title');
		expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
	});
});
