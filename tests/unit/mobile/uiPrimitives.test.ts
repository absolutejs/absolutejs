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
	installAbsoluteMobileUiPrimitives,
	openAbsoluteMobileSheet,
	readAbsoluteMobileLinkIntent,
	requestAbsoluteMobileBack
} from '../../../src/mobile/uiPrimitives';

beforeAll(() =>
	GlobalRegistrator.register({ url: 'https://example.com/home' })
);
afterAll(() => GlobalRegistrator.unregister());

beforeEach(() => {
	document.documentElement.replaceChildren(
		document.createElement('head'),
		document.createElement('body')
	);
	for (const attribute of [...document.documentElement.attributes])
		document.documentElement.removeAttribute(attribute.name);
});

const renderFixture = () => {
	document.body.innerHTML = `
		<div data-absolute-app-shell>
			<header data-absolute-app-header>Header</header>
			<main data-absolute-app-main data-absolute-navigation-stack>Main</main>
			<nav data-absolute-tab-bar aria-label="Primary">
				<a href="/home">Home</a>
				<a href="/settings" data-absolute-tab-match="prefix">Settings</a>
			</nav>
		</div>
		<button id="open" data-absolute-sheet-open="filters">Filters</button>
		<dialog id="filters" data-absolute-sheet aria-labelledby="sheet-title">
			<h2 id="sheet-title">Filters</h2>
			<button data-absolute-sheet-close>Done</button>
		</dialog>
	`;
};

describe('mobile UI primitives', () => {
	test('installs opt-in layout styles and synchronizes semantic tab links', () => {
		renderFixture();
		const ui = installAbsoluteMobileUiPrimitives();
		ui.refreshDocument('/settings/profile?sort=new');

		expect(
			document.getElementById('absolute-mobile-ui-primitives')
		).not.toBeNull();
		expect(
			document
				.querySelector<HTMLAnchorElement>('a[href="/home"]')
				?.hasAttribute('aria-current')
		).toBe(false);
		expect(
			document
				.querySelector<HTMLAnchorElement>('a[href="/settings"]')
				?.getAttribute('aria-current')
		).toBe('page');
		expect(document.body.textContent).toContain('Main');

		ui.dispose();
	});

	test('publishes navigation direction and restores UI after document replacement', () => {
		renderFixture();
		const ui = installAbsoluteMobileUiPrimitives();
		let destination: string | undefined;
		window.addEventListener(
			'absolute:navigation-change',
			(event) => (destination = event.detail.to),
			{ once: true }
		);

		ui.navigate({ direction: 'forward', from: '/home', to: '/settings' });
		expect(
			document.documentElement.dataset.absoluteNavigationDirection
		).toBe('forward');
		expect(destination).toBe('/settings');

		document.head.replaceChildren(document.createElement('title'));
		document.body.innerHTML =
			'<nav data-absolute-tab-bar><a href="/settings">Settings</a></nav>';
		ui.refreshDocument('/settings');

		expect(
			document.getElementById('absolute-mobile-ui-primitives')
		).not.toBeNull();
		expect(document.querySelector('a')?.getAttribute('aria-current')).toBe(
			'page'
		);

		ui.dispose();
	});

	test('opens an accessible sheet and consumes back before navigation', () => {
		renderFixture();
		const ui = installAbsoluteMobileUiPrimitives();
		const opener = document.getElementById('open');
		const sheet = document.getElementById('filters');
		if (!(opener instanceof HTMLButtonElement))
			throw new TypeError('opener');
		if (!(sheet instanceof HTMLDialogElement)) throw new TypeError('sheet');

		opener.click();
		expect(sheet.open).toBe(true);
		expect(sheet.getAttribute('aria-modal')).toBe('true');
		expect(requestAbsoluteMobileBack()).toBe(true);
		expect(sheet.open).toBe(false);
		expect(document.activeElement).toBe(opener);
		expect(requestAbsoluteMobileBack()).toBe(false);
		opener.click();
		sheet.dispatchEvent(
			new MouseEvent('click', {
				bubbles: true,
				clientX: 1,
				clientY: 1
			})
		);
		expect(sheet.open).toBe(false);
		expect(openAbsoluteMobileSheet('missing')).toBe(false);

		ui.dispose();
	});

	test('reads progressive link intents without replacing anchor semantics', () => {
		const anchor = document.createElement('a');
		anchor.href = '/account';
		expect(readAbsoluteMobileLinkIntent(anchor)).toEqual({
			kind: 'navigate',
			replace: false
		});
		anchor.dataset.absoluteLink = 'replace';
		expect(readAbsoluteMobileLinkIntent(anchor)).toEqual({
			kind: 'navigate',
			replace: true
		});
		anchor.dataset.absoluteLink = 'back';
		expect(readAbsoluteMobileLinkIntent(anchor)).toEqual({ kind: 'back' });
		anchor.dataset.absoluteLink = 'external';
		expect(readAbsoluteMobileLinkIntent(anchor)).toEqual({
			kind: 'external'
		});
	});
});
