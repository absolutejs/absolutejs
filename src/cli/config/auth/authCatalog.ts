// The @absolutejs/auth capability catalog, condensed from the AuthConfig JSDoc.
// Each entry's `configKey` is the optional property on the `auth({...})` config;
// the resolver flips `configured` when it finds that key in the scanned setup.
// `routes` features mount HTTP endpoints; `behavior` features only change how the
// core flows act (emit events, add a derive, throttle). Order = display order.

type AuthFeatureMeta = {
	blurb: string;
	configKey: string;
	id: string;
	kind: 'behavior' | 'routes';
	label: string;
};

// The OAuth2 routes auth() always mounts, regardless of which features are on.
export const AUTH_CORE_ROUTES = [
	'authorize',
	'callback',
	'profile',
	'status',
	'signout',
	'refresh',
	'revoke'
];

export const AUTH_FEATURES: AuthFeatureMeta[] = [
	{
		blurb: 'Email/password — register, verify-email, login, reset-password — minting the same session as OAuth.',
		configKey: 'credentials',
		id: 'credentials',
		kind: 'routes',
		label: 'Credentials'
	},
	{
		blurb: 'Magic links + email/SMS one-time codes; each verify route mints the same session as every other flow.',
		configKey: 'passwordless',
		id: 'passwordless',
		kind: 'routes',
		label: 'Passwordless'
	},
	{
		blurb: 'TOTP + backup codes; auto-wires the login MFA gate over credentials and mounts enroll/challenge routes.',
		configKey: 'mfa',
		id: 'mfa',
		kind: 'routes',
		label: 'MFA'
	},
	{
		blurb: 'Passkeys (WebAuthn): registration ceremony for the caller + passwordless authentication ceremony.',
		configKey: 'webauthn',
		id: 'webauthn',
		kind: 'routes',
		label: 'WebAuthn / passkeys'
	},
	{
		blurb: 'Per-organization enterprise SSO (OIDC + SAML); id_tokens verified in-house against the issuer JWKS.',
		configKey: 'sso',
		id: 'sso',
		kind: 'routes',
		label: 'Enterprise SSO'
	},
	{
		blurb: 'SCIM 2.0 directory provisioning (Okta / Azure AD) with per-org bearer-token auth.',
		configKey: 'scim',
		id: 'scim',
		kind: 'routes',
		label: 'SCIM provisioning'
	},
	{
		blurb: 'First-class multi-tenancy: orgs, memberships, invitations, and org-scoped roles.',
		configKey: 'organizations',
		id: 'organizations',
		kind: 'routes',
		label: 'Organizations'
	},
	{
		blurb: 'Org-scoped roles & permissions — list an org’s roles and set a member’s roles.',
		configKey: 'roles',
		id: 'roles',
		kind: 'routes',
		label: 'Roles & permissions'
	},
	{
		blurb: 'Headless admin-portal setup-link endpoints so a customer’s IT admin self-serves their SSO/SCIM.',
		configKey: 'portal',
		id: 'portal',
		kind: 'routes',
		label: 'Admin portal'
	},
	{
		blurb: 'Self-service session management: list the caller’s active sessions and remote-revoke by id.',
		configKey: 'sessions',
		id: 'sessions',
		kind: 'routes',
		label: 'Session management'
	},
	{
		blurb: 'GDPR/CCPA self-service: data export (right to access) + erasure (right to be forgotten).',
		configKey: 'compliance',
		id: 'compliance',
		kind: 'routes',
		label: 'Compliance'
	},
	{
		blurb: 'Built-in HTMX fragment routes (login, identities, connectors, account, signout, delete-account).',
		configKey: 'htmx',
		id: 'htmx',
		kind: 'routes',
		label: 'HTMX fragments'
	},
	{
		blurb: 'Append-only structured audit events (register, login, mfa_*, logout…) to your store + hook. SOC 2 prerequisite.',
		configKey: 'audit',
		id: 'audit',
		kind: 'behavior',
		label: 'Audit log'
	},
	{
		blurb: 'HMAC-signed outbound webhooks (Standard Webhooks) for every emitted auth event.',
		configKey: 'webhooks',
		id: 'webhooks',
		kind: 'behavior',
		label: 'Webhooks'
	},
	{
		blurb: 'RBAC/ABAC: adds a protectPermission(check, handler) derive that delegates to your hasPermission hook.',
		configKey: 'authorization',
		id: 'authorization',
		kind: 'behavior',
		label: 'Authorization'
	},
	{
		blurb: 'Per-identity attempt throttling + progressive account lockout on the credential login route.',
		configKey: 'lockout',
		id: 'lockout',
		kind: 'behavior',
		label: 'Lockout'
	}
];
