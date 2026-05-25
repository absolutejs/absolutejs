import type { FieldNode } from './config';

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
	/** Whether `absolute add auth:<id>` / the panel can scaffold starter wiring. */
	scaffoldable: boolean;
};

/** Result of scaffolding a feature's starter wiring — shared by the CLI
 *  (`absolute add auth:<feature>`) and the panel's "Scaffold wiring" button. */
export type AuthScaffoldResult = {
	created: string | null;
	installed: boolean;
	message: string;
	ok: boolean;
	spreadSnippet: string | null;
};

/** The editable, serializable settings slice — introspected from the `AuthSettings`
 *  type in @absolutejs/auth and read from the consumer's `auth.config.ts`. Mirrors
 *  the absolute.config panel's state. */
export type AuthSettingsState = {
	/** False when the AuthSettings type couldn't be resolved (auth too old / absent). */
	available: boolean;
	configPath: string | null;
	current: Record<string, unknown>;
	fields: FieldNode[];
	opaqueKeys: string[];
};

/** Read-only introspection of an app's @absolutejs/auth setup, produced by
 *  `resolveAuthState` and rendered by the Auth panel. The feature config lives in
 *  code (the `auth({...})` call), so `introspected` records whether we could read
 *  the configured keys; `settings` is the editable serializable slice. */
export type AuthPanelState = {
	declaredVersion: string | null;
	features: AuthFeatureStatus[];
	installed: boolean;
	installedVersion: string | null;
	introspected: boolean;
	npmUrl: string;
	providerCount: number | null;
	repoUrl: string;
	settings: AuthSettingsState;
	setupPath: string | null;
	usesSpread: boolean;
};

export type AuthConfigEditRequest = {
	name: string;
	remove?: boolean;
	value?: unknown;
};

export type AuthConfigEditResult = {
	message: string;
	ok: boolean;
	state: AuthPanelState | null;
};
