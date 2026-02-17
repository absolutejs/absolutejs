/* Extend Window interface with HMR-specific globals */
declare global {
	interface Window {
		/* Framework for current page, set at build time in index files */
		__HMR_FRAMEWORK__?: string;

		/* HMR manifest - maps component names to built file paths */
		__HMR_MANIFEST__?: Record<string, string>;

		/* Array of pending HMR module updates */
		__HMR_MODULE_UPDATES__?: Array<unknown>;

		/* Client-side module versions - tracks what version the client has loaded */
		__HMR_MODULE_VERSIONS__?: Record<string, number>;

		/* Server-side module versions - tracks what version the server has */
		__HMR_SERVER_VERSIONS__?: Record<string, number>;

		/* React root instance for HMR re-rendering */
		__REACT_ROOT__?: {
			render: (element: unknown) => void;
		};

		/* Initial props passed to React component */
		__INITIAL_PROPS__?: Record<string, unknown>;

		/* Preserved state across HMR updates */
		__HMR_PRESERVED_STATE__?: Record<string, unknown>;

		/* Update counter for debugging */
		__HMR_UPDATE_COUNT__?: number;

		/* Svelte component instance */
		__SVELTE_COMPONENT__?: Record<string, unknown>;

		/* Svelte unmount function (closure over current runtime + component) */
		__SVELTE_UNMOUNT__?: () => void;

		/* WebSocket instance for HMR */
		__HMR_WS__?: WebSocket;

		/* HTMX global (if HTMX is loaded) */
		htmx?: {
			process: (element: HTMLElement | Document) => void;
		};

		/* DOM state preserved during HTML/HTMX HMR updates */
		__HMR_DOM_STATE__?: { count?: number; [key: string]: unknown };
	}
}

/* Export empty object to make this a module */
export {};
