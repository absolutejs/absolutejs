import type {
	AllowedComponentProps,
	App,
	ComponentCustomProps,
	VNodeProps
} from 'vue';

/** Structural shape of vue-router we expose to user code. Keeps the helper
 *  free of a hard dependency on `vue-router` types — users opt in to the
 *  router by exporting `routes`, the package shouldn't pull a peer dep
 *  type-check into every consumer. */
export type VueAutoRouter = {
	currentRoute: { value: { fullPath: string } };
	push: (to: string) => Promise<unknown>;
	isReady: () => Promise<void>;
	beforeEach: (
		guard: (to: unknown, from: unknown) => unknown
	) => () => void;
};

export type VueSetupAppContext = {
	url: string;
	isServer: boolean;
	/** The vue-router instance AbsoluteJS auto-created from the page's
	 *  `routes` export, already installed on the app and navigated to
	 *  the request URL. `null` when the page didn't export `routes`. */
	router: VueAutoRouter | null;
	/** Server-only. Call to short-circuit SSR and emit an HTTP redirect
	 *  instead. Pass the destination location and an optional status
	 *  (defaults to `302`). */
	setRedirect: (location: string, status?: number) => void;
};

export type VueSetupApp = (
	app: App,
	ctx: VueSetupAppContext
) => void | Promise<void>;

type ReservedVueProps =
	| keyof VNodeProps
	| keyof AllowedComponentProps
	| keyof ComponentCustomProps;

export type VuePropsOf<C> = C extends new () => { $props: infer Props }
	? Omit<Props, ReservedVueProps>
	: C extends (props: infer Props, ...args: never[]) => unknown
		? Props extends Record<string, unknown>
			? Props
			: Record<string, never>
		: Record<string, never>;

export type VueVNode = {
	children?: VueVNode[];
	component?: VueComponentInstance;
};

export type VueComponentInstance = {
	setupState?: Record<string, unknown>;
	subTree?: VueVNode;
};
