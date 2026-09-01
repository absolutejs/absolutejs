const STYLE_ID = 'absolute-mobile-ui-primitives';
const NAVIGATION_EVENT = 'absolute:navigation-change';
const SHEET_EVENT = 'absolute:sheet-change';
const BACK_EVENT = 'absolute:back-request';
const ACTIVE_SHEET_SELECTOR = 'dialog[data-absolute-sheet][open]';
const TAB_LINK_SELECTOR = '[data-absolute-tab-bar] a[href]';

const UI_STYLE = `
[data-absolute-app-shell] {
	display: grid;
	grid-template-rows: auto minmax(0, 1fr) auto;
	box-sizing: border-box;
	min-height: var(--absolute-available-height, 100dvh);
	padding-inline: var(--absolute-safe-area-inset-left, 0px) var(--absolute-safe-area-inset-right, 0px);
}
[data-absolute-app-header] {
	padding-top: var(--absolute-safe-area-inset-top, 0px);
}
[data-absolute-app-main], [data-absolute-navigation-stack] {
	min-width: 0;
	min-height: 0;
}
[data-absolute-app-main] {
	overflow: auto;
	overscroll-behavior-y: contain;
}
[data-absolute-navigation-stack] {
	view-transition-name: absolute-mobile-stack;
}
[data-absolute-tab-bar] {
	display: flex;
	align-items: stretch;
	justify-content: space-around;
	box-sizing: border-box;
	padding-bottom: var(--absolute-safe-area-inset-bottom, 0px);
	background: Canvas;
	color: CanvasText;
}
[data-absolute-tab-bar] > a {
	display: grid;
	flex: 1 1 0;
	min-width: 0;
	min-height: 2.75rem;
	place-items: center;
	padding: 0.375rem 0.5rem;
	color: inherit;
	text-align: center;
	text-decoration: none;
	touch-action: manipulation;
}
[data-absolute-tab-bar] > a[aria-current="page"] {
	font-weight: 700;
}
dialog[data-absolute-sheet] {
	box-sizing: border-box;
	width: min(100%, var(--absolute-sheet-max-width, 42rem));
	max-height: min(90dvh, var(--absolute-available-height, 90dvh));
	margin: auto auto 0;
	padding: 1rem max(1rem, var(--absolute-safe-area-inset-right, 0px)) max(1rem, var(--absolute-safe-area-inset-bottom, 0px)) max(1rem, var(--absolute-safe-area-inset-left, 0px));
	overflow: auto;
	border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
	border-radius: 1rem 1rem 0 0;
	background: Canvas;
	color: CanvasText;
	box-shadow: 0 -0.5rem 2rem color-mix(in srgb, CanvasText 18%, transparent);
}
dialog[data-absolute-sheet]::backdrop {
	background: color-mix(in srgb, CanvasText 38%, transparent);
}
@keyframes absolute-mobile-forward-old { to { opacity: 0; transform: translateX(-12%); } }
@keyframes absolute-mobile-forward-new { from { opacity: 0; transform: translateX(12%); } }
@keyframes absolute-mobile-back-old { to { opacity: 0; transform: translateX(12%); } }
@keyframes absolute-mobile-back-new { from { opacity: 0; transform: translateX(-12%); } }
html[data-absolute-navigation-direction="forward"]::view-transition-old(absolute-mobile-stack) { animation: 180ms ease both absolute-mobile-forward-old; }
html[data-absolute-navigation-direction="forward"]::view-transition-new(absolute-mobile-stack) { animation: 180ms ease both absolute-mobile-forward-new; }
html[data-absolute-navigation-direction="back"]::view-transition-old(absolute-mobile-stack) { animation: 180ms ease both absolute-mobile-back-old; }
html[data-absolute-navigation-direction="back"]::view-transition-new(absolute-mobile-stack) { animation: 180ms ease both absolute-mobile-back-new; }
html[data-absolute-reduced-motion="reduce"]::view-transition-old(absolute-mobile-stack),
html[data-absolute-reduced-motion="reduce"]::view-transition-new(absolute-mobile-stack) { animation: none; }
`;

export type AbsoluteMobileNavigationDirection = 'back' | 'forward' | 'replace';

export type AbsoluteMobileNavigationDetail = {
	direction: AbsoluteMobileNavigationDirection;
	from: string;
	to: string;
};

export type AbsoluteMobileSheetDetail = {
	id: string;
	open: boolean;
};

export type AbsoluteMobileLinkIntent =
	| { kind: 'back' }
	| { kind: 'external' }
	| { kind: 'navigate'; replace: boolean };

declare global {
	// Event-map augmentation requires interface merging.
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
	interface WindowEventMap {
		'absolute:back-request': CustomEvent;
		'absolute:navigation-change': CustomEvent<AbsoluteMobileNavigationDetail>;
		'absolute:sheet-change': CustomEvent<AbsoluteMobileSheetDetail>;
	}
}

export type AbsoluteMobileUiPrimitives = {
	dispose(): void;
	navigate(detail: AbsoluteMobileNavigationDetail): void;
	refreshDocument(path?: string): void;
	requestBack(): boolean;
};

const currentPath = () =>
	`${location.pathname}${location.search}${location.hash}`;

const ensureStyle = () => {
	let style = document.getElementById(STYLE_ID);
	if (!(style instanceof HTMLStyleElement)) {
		style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = UI_STYLE;
		document.head.append(style);
	}
};

const sheetById = (id: string) => {
	const target = document.getElementById(id);

	return target instanceof HTMLDialogElement &&
		target.dataset.absoluteSheet !== undefined
		? target
		: undefined;
};

const dispatchSheet = (sheet: HTMLDialogElement, open: boolean) =>
	dispatchEvent(
		new CustomEvent<AbsoluteMobileSheetDetail>(SHEET_EVENT, {
			detail: { id: sheet.id, open }
		})
	);

const focusSheet = (sheet: HTMLDialogElement) => {
	const target = sheet.querySelector<HTMLElement>(
		'[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
	);
	(target ?? sheet).focus();
};

const sheetOpeners = new WeakMap<HTMLDialogElement, HTMLElement>();

export const closeAbsoluteMobileSheet = (
	target: HTMLDialogElement | string
) => {
	const sheet = typeof target === 'string' ? sheetById(target) : target;
	if (!sheet || !sheet.open) return false;
	if (typeof sheet.close === 'function') sheet.close();
	else sheet.removeAttribute('open');
	sheet.removeAttribute('aria-modal');
	sheetOpeners.get(sheet)?.focus();
	sheetOpeners.delete(sheet);
	dispatchSheet(sheet, false);

	return true;
};
export const openAbsoluteMobileSheet = (
	target: HTMLDialogElement | string,
	opener?: HTMLElement
) => {
	const sheet = typeof target === 'string' ? sheetById(target) : target;
	if (!sheet || sheet.dataset.absoluteSheet === undefined) return false;
	const active = document.querySelector<HTMLDialogElement>(
		ACTIVE_SHEET_SELECTOR
	);
	if (active && active !== sheet) closeAbsoluteMobileSheet(active);
	if (opener) sheetOpeners.set(sheet, opener);
	if (!sheet.open) {
		if (typeof sheet.showModal === 'function') sheet.showModal();
		else sheet.setAttribute('open', '');
	}
	sheet.setAttribute('aria-modal', 'true');
	focusSheet(sheet);
	dispatchSheet(sheet, true);

	return true;
};
export const readAbsoluteMobileLinkIntent = (
	anchor: HTMLAnchorElement
): AbsoluteMobileLinkIntent => {
	const mode = anchor.dataset.absoluteLink;
	if (mode === 'back') return { kind: 'back' };
	if (mode === 'external') return { kind: 'external' };

	return { kind: 'navigate', replace: mode === 'replace' };
};
export const requestAbsoluteMobileBack = () => {
	const event = new CustomEvent(BACK_EVENT, { cancelable: true });

	return !dispatchEvent(event);
};

const normalizePathname = (value: string) => {
	try {
		return (
			new URL(value, location.href).pathname.replace(/\/$/u, '') || '/'
		);
	} catch {
		return undefined;
	}
};

const syncTabLinks = (path: string) => {
	const activePath = normalizePathname(path);
	if (!activePath) return;
	document
		.querySelectorAll<HTMLAnchorElement>(TAB_LINK_SELECTOR)
		.forEach((anchor) => {
			const candidate = normalizePathname(anchor.href);
			const prefix = anchor.dataset.absoluteTabMatch === 'prefix';
			const active =
				candidate !== undefined &&
				(prefix
					? activePath === candidate ||
						(candidate !== '/' &&
							activePath.startsWith(`${candidate}/`))
					: activePath === candidate);
			if (active) anchor.setAttribute('aria-current', 'page');
			else anchor.removeAttribute('aria-current');
		});
};

/** Installs optional semantic-HTML mobile layout and interaction primitives. */
export const installAbsoluteMobileUiPrimitives =
	(): AbsoluteMobileUiPrimitives => {
		let disposed = false;
		let scheduled = false;
		let path = currentPath();
		const refreshDocument = (nextPath = path) => {
			if (disposed || !document.head || !document.body) return;
			path = nextPath;
			ensureStyle();
			syncTabLinks(path);
		};
		const scheduleRefresh = () => {
			if (scheduled || disposed) return;
			scheduled = true;
			queueMicrotask(() => {
				scheduled = false;
				refreshDocument();
			});
		};
		const handleClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			const opener = event.target.closest<HTMLElement>(
				'[data-absolute-sheet-open]'
			);
			if (opener?.dataset.absoluteSheetOpen) {
				if (
					openAbsoluteMobileSheet(
						opener.dataset.absoluteSheetOpen,
						opener
					)
				)
					event.preventDefault();

				return;
			}
			const closer = event.target.closest<HTMLElement>(
				'[data-absolute-sheet-close]'
			);
			const sheet = closer?.closest<HTMLDialogElement>(
				'dialog[data-absolute-sheet]'
			);
			if (sheet && closeAbsoluteMobileSheet(sheet)) {
				event.preventDefault();

				return;
			}
			if (
				event.target instanceof HTMLDialogElement &&
				event.target.dataset.absoluteSheet !== undefined
			) {
				const rect = event.target.getBoundingClientRect();
				const outside =
					event.clientX < rect.left ||
					event.clientX > rect.right ||
					event.clientY < rect.top ||
					event.clientY > rect.bottom;
				if (outside && closeAbsoluteMobileSheet(event.target))
					event.preventDefault();
			}
		};
		const handleCancel = (event: Event) => {
			if (!(event.target instanceof HTMLDialogElement)) return;
			if (event.target.dataset.absoluteSheet === undefined) return;
			event.preventDefault();
			closeAbsoluteMobileSheet(event.target);
		};
		const handleBack = (event: Event) => {
			const active = document.querySelector<HTMLDialogElement>(
				ACTIVE_SHEET_SELECTOR
			);
			if (!active) return;
			event.preventDefault();
			closeAbsoluteMobileSheet(active);
		};
		const observer = new MutationObserver(scheduleRefresh);
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true
		});
		addEventListener('click', handleClick);
		addEventListener('cancel', handleCancel, true);
		addEventListener(BACK_EVENT, handleBack);
		refreshDocument();

		return {
			refreshDocument,
			requestBack: requestAbsoluteMobileBack,
			dispose: () => {
				if (disposed) return;
				disposed = true;
				observer.disconnect();
				removeEventListener('click', handleClick);
				removeEventListener('cancel', handleCancel, true);
				removeEventListener(BACK_EVENT, handleBack);
			},
			navigate: (detail) => {
				path = detail.to;
				document.documentElement.dataset.absoluteNavigationDirection =
					detail.direction;
				refreshDocument(path);
				dispatchEvent(
					new CustomEvent<AbsoluteMobileNavigationDetail>(
						NAVIGATION_EVENT,
						{
							detail
						}
					)
				);
			}
		};
	};
