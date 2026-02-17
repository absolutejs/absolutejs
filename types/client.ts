/* Client-side HMR type definitions */

export interface ErrorOverlayOptions {
	column?: number;
	file?: string;
	framework?: string;
	line?: number;
	lineText?: string;
	message?: string;
}

export interface DOMStateEntry {
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
}

export interface DOMStateSnapshot {
	activeKey: string | null;
	items: DOMStateEntry[];
}

export interface SavedComponentState {
	count: number;
}

export interface SavedState {
	componentState: SavedComponentState;
	forms: Record<string, Record<string, boolean | string>>;
	scroll: { window: { x: number; y: number } };
}

export interface ScriptInfo {
	src: string;
	type: string;
}

export interface CSSUpdateResult {
	linksToActivate: HTMLLinkElement[];
	linksToRemove: HTMLLinkElement[];
	linksToWaitFor: Promise<void>[];
}

/* Shared mutable state for the HMR client */
export const hmrState = {
	isConnected: false,
	isFirstHMRUpdate: true,
	isHMRUpdating: false,
	pingInterval: null as ReturnType<typeof setInterval> | null,
	reconnectTimeout: null as ReturnType<typeof setTimeout> | null
};

/* Window interface extensions for HMR globals */
declare global {
	interface Window {
		$RefreshReg$?: (type: unknown, id: string) => void;
		$RefreshRuntime$?: {
			createSignatureFunctionForTransform: () => (
				type: unknown
			) => unknown;
			injectIntoGlobalHook: (win: Window) => void;
			performReactRefresh: () => void;
			register: (type: unknown, id: string) => void;
		};
		$RefreshSig$?: () => (type: unknown) => unknown;
		__HMR_DOM_STATE__?: { count?: number; [key: string]: unknown };
		__HMR_FRAMEWORK__?: string;
		__HMR_MANIFEST__?: Record<string, string>;
		__HMR_MODULE_UPDATES__?: Array<unknown>;
		__HMR_MODULE_VERSIONS__?: Record<string, number>;
		__HMR_PRESERVED_STATE__?: Record<string, unknown>;
		__HMR_SERVER_VERSIONS__?: Record<string, number>;
		__HMR_UPDATE_COUNT__?: number;
		__HMR_WS__?: WebSocket;
		__INITIAL_PROPS__?: Record<string, unknown>;
		__REACT_ROOT__?: { render: (element: unknown) => void };
		__SVELTE_COMPONENT__?: Record<string, unknown>;
		__SVELTE_UNMOUNT__?: () => void;
		__VUE_APP__?:
			| ({
					unmount: () => void;
					_instance?: {
						setupState?: Record<string, unknown>;
						subTree?: {
							children?: unknown[];
							component?: {
								setupState?: Record<string, unknown>;
								subTree?: unknown;
							};
						};
					};
			  } & Record<string, unknown>)
			| null;
		__VUE_HMR_COMPONENTS__?: Record<string, unknown>;
		htmx?: { process: (element: HTMLElement | Document) => void };
	}
}

export {};
