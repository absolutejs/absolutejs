export type ErrorOverlayOptions = {
	column?: number;
	file?: string;
	framework?: string;
	kind?: 'compilation' | 'runtime';
	line?: number;
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
