export type ErrorOverlayOptions = {
	column?: number;
	file?: string;
	framework?: string;
	kind?: 'compilation' | 'runtime';
	line?: number;
	lineText?: string;
	message?: string;
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

/* Window interface extensions for HMR globals */
declare global {
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration merging requires interface
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
		__HMR_FRAMEWORK__?: string;
		__HMR_MANIFEST__?: Record<string, string>;
		__HMR_MODULE_UPDATES__?: Array<unknown>;
		__HMR_MODULE_VERSIONS__?: Record<string, number>;
		__HMR_PRESERVED_STATE__?: Record<string, unknown>;
		__HMR_SERVER_VERSIONS__?: Record<string, number>;
		__HMR_UPDATE_COUNT__?: number;
		__HMR_WS__?: WebSocket;
		__ERROR_BOUNDARY__?: { reset: () => void };
		__INITIAL_PROPS__?: Record<string, unknown>;
		__REACT_ROOT__?: { render: (element: unknown) => void };
		__SVELTE_COMPONENT__?: Record<string, unknown>;
		__SVELTE_UNMOUNT__?: () => void;
		__ANGULAR_APP__?: { destroy: () => void; tick: () => void } | null;
		__HMR_SKIP_HYDRATION__?: boolean;
		__HMR_NEW_PAGE_CLASS__?: unknown;
		__NG_REPLACE_METADATA__?: (...args: unknown[]) => void;
		__ANGULAR_HMR__?: {
			register: (id: string, ctor: unknown) => void;
			applyUpdate: (id: string, newCtor: unknown) => boolean;
			refresh: () => void;
			getStats: () => { componentCount: number; updateCount: number };
			getRegistry: () => Map<
				string,
				{
					liveCtor: unknown;
					id: string;
					registeredAt: number;
					updateCount: number;
				}
			>;
		};
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
