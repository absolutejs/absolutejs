import type {
	AllowedComponentProps,
	App,
	ComponentCustomProps,
	VNodeProps
} from 'vue';
import type { Router } from 'vue-router';

/** The vue-router instance AbsoluteJS auto-creates from a page's `routes`
 *  export. Aliased to vue-router's own `Router` so consumers get the full,
 *  always-current API (`onError`, `afterEach`, `resolve`, …) rather than a
 *  hand-mirrored subset that silently drifts out of date — the missing
 *  `onError` is exactly the kind of gap a duplicated type hides. `vue-router`
 *  is an optional peer dependency: only pages that export `routes` reference
 *  this type, and those pages already depend on vue-router. */
export type VueAutoRouter = Router;

export type VueSetupAppContext = {
	url: string;
	isServer: boolean;
	/** The vue-router instance AbsoluteJS auto-created from the page's
	 *  `routes` export, already installed on the app and navigated to
	 *  the request URL. `null` when the page didn't export `routes`. */
	router: Router | null;
	/** Server-only. Call to short-circuit SSR and emit an HTTP redirect
	 *  instead. Pass the destination location and an optional status
	 *  (defaults to `302`). */
	setRedirect: (location: string, status?: number) => void;
};

export type VueSetupApp = (
	app: App,
	ctx: VueSetupAppContext
) => void | Promise<void>;

/** Structural shape of a single vue-router route record. Kept loose
 *  because absolutejs doesn't depend on `vue-router` types — users who
 *  want stricter typing can annotate with `RouteRecordRaw[]` from
 *  vue-router themselves. */
export type VueRouteRecord = {
	path: string;
	component?: unknown;
	children?: VueRouteRecord[];
	name?: string;
	redirect?: string | { name: string };
	meta?: Record<string, unknown>;
};

export type VueRoutes = readonly VueRouteRecord[];

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
