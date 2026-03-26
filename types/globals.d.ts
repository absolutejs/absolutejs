declare global {
	/* Server-side globals (Bun --hot reload state) */
	var __hmrServerStartup: boolean | undefined;
	var __hmrBuildDuration: number | undefined;
	var __absoluteVersion: string | undefined;
	var __hmrServerMtime: number | undefined;
	var __hmrSkipServerRestart: boolean | undefined;
	/** Pinned React module from initial devBuild — used to detect and bridge
	 *  duplicate React instances after bun install invalidates the module cache. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	var __reactModuleRef: any;
	var __depVendorPaths: Record<string, string> | undefined;
	var __http2Config:
		| {
				hmrState: import('../src/dev/clientManager').HMRState;
				manifest: Record<string, string>;
		  }
		| undefined;
	var __hmrDevResult:
		| {
				hmrState: import('../src/dev/clientManager').HMRState;
				manifest: Record<string, string>;
		  }
		| undefined;

	/* Client-side globals (Window extensions for HMR) */
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
		__REACT_COMPONENT_KEY__?: string;
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
					_instance?: import('./vue').VueComponentInstance;
			  } & Record<string, unknown>)
			| null;
		__VUE_HMR_COMPONENTS__?: Record<string, unknown>;
		htmx?: { process: (element: HTMLElement | Document) => void };
	}
}

export {};
