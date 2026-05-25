// Per-feature scaffold descriptors for `absolute add auth:<feature>` and the
// config:studio "Scaffold wiring" button. Each describes the starter wiring file
// the wizard writes: a typed config block exporting `<feature>Config` with the
// REQUIRED code fields as TODO stubs (stores seeded with the in-memory factory,
// hooks throwing a descriptive TODO) plus a few sensible optional-data defaults.
// The consumer spreads the export into their `auth({ ... <configKey>: <feature>Config })`.
//
// Values are raw TypeScript expressions emitted verbatim; `generic` features get a
// `type User` placeholder + a `<User>` type argument. Field shapes are derived from
// `@absolutejs/auth/src/<feature>/config.ts`.

export type AuthScaffoldField = {
	name: string;
	value: string;
};

export type AuthScaffold = {
	configKey: string;
	exportName: string;
	fields: AuthScaffoldField[];
	generic: boolean;
	imports: string[];
	note: string | null;
	packages: string[];
	typeName: string;
};

const TODO = (message: string) =>
	`async () => { throw new Error("TODO: ${message}"); }`;

export const AUTH_SCAFFOLDS: Record<string, AuthScaffold> = {
	audit: {
		configKey: 'audit',
		exportName: 'auditConfig',
		fields: [
			{ name: 'auditStore', value: 'createInMemoryAuditSink()' },
			{ name: 'getUserId', value: '(user) => user.sub' }
		],
		generic: true,
		imports: ['createInMemoryAuditSink'],
		note: 'Swap the in-memory sink for a durable store (append-only table); add `onAuditEvent` to forward to a SIEM.',
		packages: [],
		typeName: 'AuditConfig'
	},
	authorization: {
		configKey: 'authorization',
		exportName: 'authorizationConfig',
		fields: [
			{
				name: 'hasPermission',
				value: '({ user, permission, organizationId }) => { throw new Error("TODO: decide if user has permission"); }'
			}
		],
		generic: true,
		imports: [],
		note: 'Pair with `createMembershipPermissionResolver` (from @absolutejs/auth) when you also use organizations + roles.',
		packages: [],
		typeName: 'AuthorizationConfig'
	},
	compliance: {
		configKey: 'compliance',
		exportName: 'complianceConfig',
		fields: [
			{ name: 'deleteUserData', value: TODO('erase or anonymize the user in your stores') },
			{ name: 'exportUserData', value: 'async ({ user }) => ({})' },
			{ name: 'getUserId', value: '(user) => user.sub' }
		],
		generic: true,
		imports: [],
		note: 'exportUserData must return everything you hold on the user; getUserId lets the route revoke sibling sessions.',
		packages: [],
		typeName: 'ComplianceConfig'
	},
	credentials: {
		configKey: 'credentials',
		exportName: 'credentialsConfig',
		fields: [
			{ name: 'credentialStore', value: 'createInMemoryCredentialStore()' },
			{ name: 'getUserByEmail', value: TODO('look up a user by email') },
			{ name: 'onCreateCredentialUser', value: TODO('create and return the user for identity.email') },
			{ name: 'onSendEmail', value: TODO('send the verification / reset email containing message.token') },
			{ name: 'requireEmailVerification', value: 'false' }
		],
		generic: true,
		imports: ['createInMemoryCredentialStore'],
		note: 'Swap the in-memory credential store for a real one (it holds password hashes + tokens).',
		packages: [],
		typeName: 'CredentialsConfig'
	},
	lockout: {
		configKey: 'lockout',
		exportName: 'lockoutConfig',
		fields: [
			{ name: 'lockoutStore', value: 'createInMemoryLockoutStore()' },
			{ name: 'maxAttempts', value: '5' },
			{ name: 'windowMs', value: '15 * 60 * 1000' }
		],
		generic: false,
		imports: ['createInMemoryLockoutStore'],
		note: 'Throttles the credential login route; pair with the `credentials` block.',
		packages: [],
		typeName: 'LockoutConfig'
	},
	mfa: {
		configKey: 'mfa',
		exportName: 'mfaConfig',
		fields: [
			{ name: 'mfaStore', value: 'createInMemoryMfaStore()' },
			{ name: 'getUserId', value: '(user) => user.sub' },
			{ name: 'getChallengeUser', value: TODO('resolve the parked challenge identity to a user') },
			{ name: 'issuer', value: "'YourApp'" }
		],
		generic: true,
		imports: ['createInMemoryMfaStore'],
		note: 'Set `encryptionKey` (base64url) to encrypt the TOTP secret at rest in any real deployment.',
		packages: [],
		typeName: 'MfaConfig'
	},
	organizations: {
		configKey: 'organizations',
		exportName: 'organizationsConfig',
		fields: [
			{ name: 'getUserId', value: '(user) => user.sub' },
			{ name: 'organizationStore', value: 'createInMemoryOrganizationStore()' }
		],
		generic: true,
		imports: ['createInMemoryOrganizationStore'],
		note: 'Add `onSendInvitation` to deliver invite emails; otherwise the plaintext token is returned from the invite route.',
		packages: [],
		typeName: 'OrganizationsConfig'
	},
	passwordless: {
		configKey: 'passwordless',
		exportName: 'passwordlessConfig',
		fields: [
			{ name: 'passwordlessTokenStore', value: 'createInMemoryPasswordlessTokenStore()' },
			{ name: 'getUserByEmail', value: TODO('look up a user by email') },
			{ name: 'onSendMagicLink', value: TODO('email the magic link containing message.token') }
		],
		generic: true,
		imports: ['createInMemoryPasswordlessTokenStore'],
		note: 'The magic-link flow mounts when `onSendMagicLink` is set; add `onSendOtp` to also mount the email/SMS OTP flow.',
		packages: [],
		typeName: 'PasswordlessConfig'
	},
	portal: {
		configKey: 'portal',
		exportName: 'portalConfig',
		fields: [
			{ name: 'setupSessionStore', value: 'createInMemorySetupSessionStore()' }
		],
		generic: false,
		imports: ['createInMemorySetupSessionStore'],
		note: 'Pass the same `ssoConnectionStore` / `scimTokenStore` your sso / scim blocks use so portal edits take effect live.',
		packages: [],
		typeName: 'PortalConfig'
	},
	roles: {
		configKey: 'roles',
		exportName: 'rolesConfig',
		fields: [
			{ name: 'getUserId', value: '(user) => user.sub' },
			{ name: 'organizationStore', value: 'createInMemoryOrganizationStore()' },
			{ name: 'roleStore', value: 'createInMemoryRoleStore()' }
		],
		generic: true,
		imports: ['createInMemoryOrganizationStore', 'createInMemoryRoleStore'],
		note: 'Builds on the `organizations` block — reuse the same organizationStore instance there.',
		packages: [],
		typeName: 'RolesConfig'
	},
	scim: {
		configKey: 'scim',
		exportName: 'scimConfig',
		fields: [
			{ name: 'scimTokenStore', value: 'createInMemoryScimTokenStore()' },
			{ name: 'getScimUser', value: TODO('return the SCIM user for { id, organizationId }') },
			{ name: 'listScimUsers', value: 'async () => []' },
			{ name: 'onScimUserCreate', value: TODO('create and return the SCIM user') },
			{ name: 'onScimUserDeactivate', value: TODO('deprovision the user (hard-delete or deactivate)') },
			{ name: 'onScimUserReplace', value: TODO('replace and return the SCIM user (undefined if unknown)') }
		],
		generic: false,
		imports: ['createInMemoryScimTokenStore'],
		note: 'Group hooks are optional (the /Groups routes 501 without them). Mint per-org tokens with `createScimToken`.',
		packages: [],
		typeName: 'ScimConfig'
	},
	sessions: {
		configKey: 'sessions',
		exportName: 'sessionsConfig',
		fields: [{ name: 'getUserId', value: '(user) => user.sub' }],
		generic: true,
		imports: [],
		note: 'Requires an `authSessionStore` (top-level) that can enumerate a user’s sessions.',
		packages: [],
		typeName: 'SessionsConfig'
	},
	sso: {
		configKey: 'sso',
		exportName: 'ssoConfig',
		fields: [
			{ name: 'ssoConnectionStore', value: 'createInMemorySsoConnectionStore()' },
			{ name: 'getSsoUser', value: TODO('map the verified SSO identity to your user (create on first sign-in)') }
		],
		generic: true,
		imports: ['createInMemorySsoConnectionStore'],
		note: 'OIDC works out of the box; add a `samlAdapter` (wrapping e.g. @node-saml/node-saml) to also mount SAML.',
		packages: [],
		typeName: 'SSOConfig'
	},
	webauthn: {
		configKey: 'webauthn',
		exportName: 'webauthnConfig',
		fields: [
			{ name: 'credentialStore', value: 'createInMemoryWebAuthnCredentialStore()' },
			{ name: 'getUserId', value: '(user) => user.sub' },
			{ name: 'getWebAuthnUser', value: TODO('resolve a stored credential userId back to a user') },
			{ name: 'origin', value: "'http://localhost:3000'" },
			{ name: 'rpId', value: "'localhost'" },
			{ name: 'rpName', value: "'YourApp'" },
			{
				name: 'webauthnAdapter',
				value: '{} as unknown as WebAuthnAdapter'
			}
		],
		generic: true,
		imports: ['createInMemoryWebAuthnCredentialStore', 'type WebAuthnAdapter'],
		note: 'Provide a real `webauthnAdapter` wrapping a vetted library (e.g. @simplewebauthn/server); set origin/rpId/rpName for your domain.',
		packages: [],
		typeName: 'WebAuthnConfig'
	},
	webhooks: {
		configKey: 'webhooks',
		exportName: 'webhooksConfig',
		fields: [{ name: 'endpoints', value: '[]' }],
		generic: false,
		imports: [],
		note: 'Add endpoints as { url, secret } — each event is HMAC-signed (Standard Webhooks) with that secret.',
		packages: [],
		typeName: 'WebhooksConfig'
	}
};

export const isScaffoldableFeature = (id: string) => id in AUTH_SCAFFOLDS;
