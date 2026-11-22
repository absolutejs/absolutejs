/** One line of an error's code frame, as the dev server read it off disk.
 *  The browser cannot read the filesystem, so the surrounding lines have
 *  to arrive with the error. */
export type ErrorOverlayFrameLine = {
	/** Zero-based column to point a caret at; only on the error line. */
	caretColumn?: number;
	isError: boolean;
	/** One-based line number, as it appears in the file. */
	number: number;
	text: string;
};

export type ErrorOverlayOptions = {
	column?: number;
	/** Lines around the error. When present the overlay renders a numbered
	 *  frame with a caret instead of the bare `lineText`. */
	codeFrame?: { lines: ErrorOverlayFrameLine[] };
	file?: string;
	framework?: string;
	kind?: 'compilation' | 'runtime';
	line?: number;
	/** The single offending line, which is all Bun's `BuildMessage`
	 *  carries. Still the fallback when no frame could be read. */
	lineText?: string;
	message?: string;
	/** Full Error.stack (or pre-formatted multi-line trace). Optional —
	 *  if `message` already starts with the error name + first line of
	 *  the stack (e.g. `${err.name}: ${err.message}\n${err.stack}`), the
	 *  overlay deduplicates internally. */
	stack?: string;
};

export type DOMStateEntry = {
	checked?: boolean;
	id?: string;
	idx: number;
	name?: string;
	open?: boolean;
	selEnd?: number;
	selStart?: number;
	selected?: boolean;
	tag: string;
	text?: string;
	type?: string;
	value?: string;
	values?: string[];
};

export type DOMStateSnapshot = {
	activeKey: string | null;
	items: DOMStateEntry[];
};

export type SavedState = {
	forms: Record<string, Record<string, boolean | string>>;
	scroll: { window: { x: number; y: number } };
};

export type HTMXSavedState = {
	componentState: { count: number };
	forms: Record<string, Record<string, boolean | string>>;
	scroll: { window: { x: number; y: number } };
};

export type ScriptInfo = {
	src: string;
	type: string;
};

export type CSSUpdateResult = {
	linksToActivate: HTMLLinkElement[];
	linksToRemove: HTMLLinkElement[];
	linksToWaitFor: Promise<void>[];
};

/* A stylesheet reload that failed without the stylesheet being gone (rate
   limit, dropped connection): `retryAt` holds further reloads of `path` off. */
export type StylesheetReloadFailure = {
	count: number;
	path: string;
	retryAt: number;
};

/* Shared mutable state for the HMR client */
export const hmrState: {
	isConnected: boolean;
	isFirstHMRUpdate: boolean;
	isHMRUpdating: boolean;
	pingInterval: ReturnType<typeof setInterval> | null;
	reconnectTimeout: ReturnType<typeof setTimeout> | null;
} = {
	isConnected: false,
	isFirstHMRUpdate: true,
	isHMRUpdating: false,
	pingInterval: null,
	reconnectTimeout: null
};
