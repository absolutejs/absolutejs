declare global {
	/* Server-side globals (Bun --hot reload state) */
	var __hmrServerStartup: boolean | undefined;
	var __hmrBuildDuration: number | undefined;
	var __absoluteVersion: string | undefined;
	var __hmrServerMtime: number | undefined;
	var __hmrSkipServerRestart: boolean | undefined;
	/** Pinned React module from initial devBuild — used to detect and bridge
	 *  duplicate React instances after bun install invalidates the module cache. */
	var __reactModuleRef: unknown;
	var __depVendorPaths: Record<string, string> | undefined;
	var __angularVendorSpecifiers: string[] | undefined;
	var __transformCache:
		| Map<string, { content: string; imports: string[]; mtime: number }>
		| undefined;
	var __transformImporters: Map<string, Set<string>> | undefined;
	/** Virtual `.svelte.css` modules (css:'external' compile output) served by
	 *  the dev moduleServer. On globalThis so it survives `bun --hot`
	 *  server re-evaluation alongside the transform cache — cached Svelte
	 *  transforms import these URLs, so the registry must outlive the module. */
	var __svelteExternalCss: Map<string, string> | undefined;
	var __transformInvalidationVersions: Map<string, number> | undefined;
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
				conventions?: import('./conventions').ConventionsMap;
		  }
		| undefined;
	/** Live `Bun.serve` instance captured by the `networking` plugin on
	 *  first listen. Subsequent re-evaluations of the entry (Path B
	 *  framework-owned backend HMR — see ABSOLUTE_CONFIG_TOGGLE_LIMITATION.md)
	 *  detect this and call `.reload({ fetch })` on the existing server
	 *  instead of re-binding the port. Stays unset outside dev. */
	var __absoluteBunServer: import('bun').Server | null | undefined;

	/** Snapshot of the previous Elysia instance's `app.store` reference,
	 *  captured by the `networking` plugin at first listen and refreshed
	 *  on each Path B reload. Used to carry user state (anything from
	 *  `.state(...)`) across in-place server-entry reloads — without
	 *  this, every edit reset all per-session data, scopedState records,
	 *  request counters, etc. The reload-aware branch in `networking`
	 *  copies values from this store back into the new app's store for
	 *  every key the new app declares. Stays unset outside dev. */
	var __absolutePreviousAppStore: Record<string, unknown> | undefined;

	/** Dev-only request inspector ring buffer, filled by the global
	 *  onRequest/onAfterResponse hooks in `requestInspector` and served at
	 *  `/__absolute/requests` for `absolute inspect`. On globalThis so it
	 *  survives Path B server-entry HMR. Stays unset outside dev. */
	var __absoluteRequestLog: import('./cli').RequestRecord[] | undefined;

	/* Client-side globals (Window extensions for HMR) */
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
		__ABS_SVELTE_ISLAND_HTML__?: Record<string, string>;
		__SVELTE_UNMOUNT__?: () => void;
		__SVELTE_REMOUNT__?: (props: Record<string, unknown>) => void;
		__ANGULAR_APP__?: {
			destroy: () => void;
			tick: () => void;
			whenStable: () => Promise<void>;
		} | null;
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
			recordPageExports: (
				sourceId: string,
				routes: unknown,
				providers: unknown
			) => void;
			hasPageExportsChanged: (sourceId: string) => boolean;
		};
		__VUE_APP__?:
			| ({
					unmount: () => void;
					_instance?: import('./vue').VueComponentInstance;
			  } & Record<string, unknown>)
			| null;
		__VUE_HMR_COMPONENTS__?: Record<string, unknown>;
		__VUE_HMR_RUNTIME__?: {
			createRecord: (id: string, component: unknown) => void;
			reload: (id: string, component: unknown) => void;
			rerender: (id: string, render: unknown) => void;
		};
		__REFRESH_BUFFER__?: Array<[unknown, string]>;
		htmx?: { process: (element: HTMLElement | Document) => void };
		__ABS_SLOT_CONSUMERS__?: Record<
			string,
			((payload: unknown) => boolean | void) | undefined
		>;
		__ABS_SLOT_ENQUEUE__?: (id: string, payload: unknown) => void;
		__ABS_SLOT_FLUSH__?: () => void;
		__ABS_SLOT_HYDRATION_PENDING__?: boolean;
		__ABS_SLOT_PENDING__?: Record<string, unknown>;
		__ABS_SLOT_RUNTIME__?: boolean;
		__ABS_ANGULAR_ISLAND_APPS__?: unknown[];
		__ABS_SERVER_ISLAND_HTML__?: Map<
			string,
			Array<{ attributes: Record<string, string>; innerHTML: string }>
		>;
	}

	/**
	 * Platform-native island element for HTML and HTMX host pages.
	 *
	 * Attributes:
	 * - `framework`: one of `react`, `svelte`, `vue`, or `angular`
	 * - `component`: the registry component name to render
	 * - `hydrate`: one of `load`, `idle`, `visible`, or `none`
	 * - `props`: JSON-serialized props payload
	 */
	interface AbsoluteIslandElement extends HTMLElement {
		component: string;
		framework: 'react' | 'svelte' | 'vue' | 'angular';
		hydrate?: 'load' | 'idle' | 'visible' | 'none';
		props: string;
	}

	interface HTMLElementTagNameMap {
		'absolute-island': AbsoluteIslandElement;
	}
}

export {};
