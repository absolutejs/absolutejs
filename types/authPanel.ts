/** One @absolutejs/auth capability, paired with whether the scanned app actually
 *  configured it. `kind` separates features that mount HTTP routes from those that
 *  only change behavior (emit events, add a derive, throttle) so the panel can say
 *  what each one does. */
export type AuthFeatureStatus = {
	blurb: string;
	configKey: string;
	configured: boolean;
	id: string;
	kind: 'behavior' | 'routes';
	label: string;
};

/** Read-only introspection of an app's @absolutejs/auth setup, produced by
 *  `resolveAuthState` and rendered by the Auth panel. The config lives in code
 *  (the `auth({...})` call), so `introspected` records whether we could actually
 *  read the configured keys — when false the panel shows the full catalog as a
 *  reference instead of a per-app status. */
export type AuthPanelState = {
	declaredVersion: string | null;
	features: AuthFeatureStatus[];
	installed: boolean;
	installedVersion: string | null;
	introspected: boolean;
	npmUrl: string;
	providerCount: number | null;
	repoUrl: string;
	setupPath: string | null;
	usesSpread: boolean;
};
