# RAG Social Connector Plan

## Objective
Design a social/email connector system in `/home/alexkahn/abs/absolutejs` that integrates with `/home/alexkahn/abs/auth` without duplicating OAuth logic.

This plan is intentionally split across two concerns:

1. durable linked-provider credentials for connector sync
2. app/session storage evolution in `auth`

Those concerns are related, but they are not the same system and should not be collapsed into one abstraction.

## Non-Goals
Do not design this as:

- RAG owning OAuth routes
- RAG reimplementing token exchange, refresh, or revoke
- RAG depending on browser cookies or one in-memory auth session
- RAG assuming `authSub + accessToken` is a sufficient durable connector identity
- linked provider credentials living only inside ephemeral login sessions

## Current Reality

### `auth`
Current `auth` is session-centric:

- OAuth authorize/callback/refresh/revoke flows already exist
- provider configuration already exists for:
  - `google`
  - `linkedin`
  - `facebook`
  - `twitter`
- token material currently lands in session / unregistered session state
- route handlers currently depend on cookie + in-process session resolution

Current limitation:

- `auth` does not yet expose a durable linked-provider grant model suitable for background connector sync

### `absolutejs`
Current `absolutejs` already trends toward bring-your-own persistence:

- RAG sync state uses `loadState` / `saveState`
- job state uses pluggable stores
- AI exports a generic `SessionStore` type
- sync sources already consume injected clients instead of hard-coded auth state

Current limitation:

- connectors can ingest from a client, but there is no generic linked-provider credential resolver layer yet

## Core Architecture

### High-level ownership split

#### `auth` owns
- provider linking
- OAuth routes
- code exchange
- refresh
- revoke
- encrypted durable provider credentials
- granted scope tracking
- provider/binding discovery
- credential health and disconnect state

#### `absolutejs` owns
- connector runtime
- sync sources
- checkpoints
- pagination / backfill logic
- normalized ingest models
- API-to-document transformation
- retry and diagnostics at connector runtime
- collection upsert and reconciliation

### The required boundary
`absolutejs` must consume a **generic credential/provider contract**, not `auth` session internals.

That means:

- `auth` exposes a durable credential resolver contract
- `absolutejs` resolves a binding and requests an access token lease
- `absolutejs` never reads auth cookies
- `absolutejs` never calls auth refresh/revoke routes as its runtime contract

## Important Separation: Sessions vs Linked Provider Credentials

These are separate tracks.

### 1. App sessions
Used for:

- who is logged into the app right now
- cookie-backed interactive auth
- protected routes and UI state

Desired future:

- BYO session store
- memory by default
- Redis / SQL / custom store support

### 2. Linked provider grants
Used for:

- durable Google/X/Meta/LinkedIn credentials
- background sync
- connector access independent of current login session

Desired future:

- encrypted durable store
- refresh ownership in `auth`
- scope-aware access

### 3. Linked provider bindings
Used for:

- concrete sync targets under a grant
- Gmail mailbox
- X account
- Facebook Page
- Instagram business account
- LinkedIn member/account binding

Desired future:

- stable binding ids used by sync sources
- many bindings per grant where needed

## Recommended Data Model

### Linked provider grant
One OAuth grant or durable provider authorization.

```ts
export type LinkedProviderGrant = {
  id: string;
  ownerRef: string;
  providerFamily: 'google' | 'linkedin' | 'x' | 'meta';
  authProviderKey: string;
  providerSubject: string;
  status: 'active' | 'refresh_required' | 'revoked' | 'error';
  grantedScopes: string[];
  accessTokenCiphertext?: string;
  refreshTokenCiphertext?: string;
  tokenType?: string;
  expiresAt?: number;
  lastRefreshedAt?: number;
  lastRefreshError?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};
```

### Linked provider binding
One grant may expose multiple usable connector resources.

```ts
export type LinkedProviderBinding = {
  id: string;
  grantId: string;
  ownerRef: string;
  connectorProvider:
    | 'gmail'
    | 'linkedin'
    | 'x'
    | 'instagram'
    | 'facebook';
  externalAccountId: string;
  externalAccountType:
    | 'mailbox'
    | 'member'
    | 'user'
    | 'page'
    | 'instagram_business';
  label?: string;
  username?: string;
  email?: string;
  status: 'active' | 'disconnected' | 'restricted';
  availableScopes: string[];
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};
```

### Resolved connector credential
The object `absolutejs` consumes.

```ts
export type ResolvedLinkedProviderCredential = {
  bindingId: string;
  grantId: string;
  ownerRef: string;
  connectorProvider:
    | 'gmail'
    | 'linkedin'
    | 'x'
    | 'instagram'
    | 'facebook';
  providerFamily: 'google' | 'linkedin' | 'x' | 'meta';
  authProviderKey: string;
  externalAccountId: string;
  externalAccountType: string;
  scopes: string[];
  capabilities?: string[];
  metadata?: Record<string, unknown>;
};
```

## Credential Resolver Contract

### Why this contract exists
`absolutejs` should request credentials generically without knowing:

- where credentials are stored
- how refresh happens
- whether auth uses cookies, memory sessions, Redis, SQL, or something else

### Resolver contract

```ts
export type ResolveLinkedProviderCredentialInput = {
  ownerRef: string;
  connectorProvider:
    | 'gmail'
    | 'linkedin'
    | 'x'
    | 'instagram'
    | 'facebook';
  bindingId?: string;
  externalAccountId?: string;
  requiredScopes?: string[];
  purpose: 'interactive_test' | 'background_sync' | 'backfill';
};

export type LinkedProviderAccessTokenLease = {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  grantedScopes: string[];
};

export type LinkedProviderCredentialFailureReport = {
  code:
    | 'unauthorized'
    | 'insufficient_scope'
    | 'revoked'
    | 'rate_limited'
    | 'provider_error';
  message?: string;
  retryAt?: number;
  metadata?: Record<string, unknown>;
};

export interface LinkedProviderCredentialResolver {
  listBindings(input: {
    ownerRef: string;
    connectorProvider?: string;
    status?: 'active' | 'restricted';
  }): Promise<LinkedProviderBinding[]>;

  resolveCredential(
    input: ResolveLinkedProviderCredentialInput
  ): Promise<ResolvedLinkedProviderCredential | null>;

  getAccessToken(
    credential: ResolvedLinkedProviderCredential,
    input?: {
      minValidityMs?: number;
      requiredScopes?: string[];
    }
  ): Promise<LinkedProviderAccessTokenLease>;

  reportFailure(
    credential: ResolvedLinkedProviderCredential,
    report: LinkedProviderCredentialFailureReport
  ): Promise<void>;
}
```

## Connector Runtime Contract

### Design rule
Connectors should consume a resolved credential plus resolver, not raw auth state.

```ts
export type RAGConnectorCheckpoint = Record<string, unknown>;

export type RAGConnectorSyncInput = {
  credential: ResolvedLinkedProviderCredential;
  resolver: LinkedProviderCredentialResolver;
  checkpoint?: RAGConnectorCheckpoint;
  signal?: AbortSignal;
};

export type RAGConnectorItem = {
  id: string;
  kind: string;
  title?: string;
  text?: string;
  html?: string;
  createdAt?: number | string | Date;
  updatedAt?: number | string | Date;
  url?: string;
  metadata?: Record<string, unknown>;
  attachments?: RAGEmailSyncAttachment[];
};

export type RAGConnectorSyncResult = {
  items: RAGConnectorItem[];
  nextCheckpoint?: RAGConnectorCheckpoint;
  diagnostics?: Record<string, unknown>;
};

export interface RAGConnectorRuntime {
  provider:
    | 'gmail'
    | 'linkedin'
    | 'x'
    | 'instagram'
    | 'facebook';
  requiredScopes(input?: { mode?: 'read' | 'write' | 'messages' }): string[];
  sync(input: RAGConnectorSyncInput): Promise<RAGConnectorSyncResult>;
}
```

### Generic connector usage pattern

```ts
const credential = await credentialResolver.resolveCredential({
  ownerRef,
  connectorProvider: 'gmail',
  bindingId,
  requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  purpose: 'background_sync'
});

if (!credential) throw new Error('No linked gmail credential');

const lease = await credentialResolver.getAccessToken(credential, {
  minValidityMs: 5 * 60 * 1000
});
```

## Connector Viability and Normalized Models

### Gmail
#### Required data surfaces
- messages
- threads
- labels
- attachments
- sent/received metadata

#### Official API path
- Gmail API
- `users.messages.list`
- `users.messages.get`

#### Likely blockers
- sensitive scopes and Google verification depending on deployment/scopes

#### Normalized ingest model
- reuse existing email normalization:
  - `RAGEmailSyncMessage`
  - `RAGEmailSyncAttachment`

#### Sync / checkpoint
- page token for backfill
- later: Gmail history/incremental support

#### Export/browser-assisted
- not primary
- official API is viable

### LinkedIn
#### Required data surfaces
- authenticated member identity
- possibly authored posts or comments if approved

#### Official API path if viable
- OIDC / member identity surfaces are viable
- broad social read is constrained

#### Likely blockers
- partner/product restrictions
- limited self-serve read access beyond profile/identity

#### Normalized ingest model
- `linkedin_member_profile`
- later optional:
  - `linkedin_post`
  - `linkedin_comment`

#### Sync / checkpoint
- profile snapshot overwrite
- post cursor only if approved product exists

#### Export/browser-assisted
- likely needed for meaningful content ingest

### X / Twitter
#### Required data surfaces
- user profile
- authored posts
- replies
- mentions
- media

#### Official API path if viable
- X API v2

#### Likely blockers
- pricing / access tier / usage variability

#### Normalized ingest model
- `x_user`
- `x_post`
- `x_reply`
- `x_mention`
- `x_media`

#### Sync / checkpoint
- newest seen post id
- pagination token for backfill

#### Export/browser-assisted
- not first choice
- official API viable if pricing is acceptable

### Instagram
#### Required data surfaces
- business/creator account profile
- media
- captions
- comments

#### Official API path if viable
- Instagram Graph API via Meta Graph

#### Likely blockers
- business/creator only
- no personal account MVP path
- Meta app review and permission approval
- Facebook Page linkage requirement

#### Normalized ingest model
- `instagram_account`
- `instagram_media`
- `instagram_comment`

#### Sync / checkpoint
- newest media id / timestamp
- comments cursor if comments are included

#### Export/browser-assisted
- yes for personal accounts or unsupported surfaces

### Facebook
#### Required data surfaces
- Page profile
- Page-authored posts
- comments
- media

#### Official API path if viable
- Meta Graph API Page surfaces

#### Likely blockers
- Page permission review
- public page content access restrictions
- personal profile/group ingestion is not a clean official MVP

#### Normalized ingest model
- `facebook_page`
- `facebook_post`
- `facebook_comment`
- `facebook_media`

#### Sync / checkpoint
- newest post id / timestamp
- comment cursor per post if enabled

#### Export/browser-assisted
- yes for personal profiles/groups
- official API viable for Pages

## Connector Roadmap

### Phase 1: credential architecture
- add durable linked provider grants in `auth`
- add durable linked provider bindings in `auth`
- add generic credential resolver in `auth`
- add generic connector runtime contract in `absolutejs`

### Phase 2: Gmail first
- use current Gmail email sync client
- resolve Google-linked mailbox credential through resolver
- connect Gmail connector into RAG sync source system

### Phase 3: X
- add X provider binding discovery in `auth`
- add X connector runtime in `absolutejs`

### Phase 4: Meta family
- add Meta grant -> binding discovery:
  - Facebook Pages
  - linked Instagram business accounts
- add Facebook Page connector
- add Instagram business connector

### Phase 5: LinkedIn
- member-profile connector first
- export/browser-assisted content path later if needed

## Required Changes in `auth`

### New store contracts
- `AuthSessionStore`
- `LinkedProviderGrantStore`
- `LinkedProviderBindingStore`
- `LinkedProviderCredentialResolver`

### New durable model
- encrypted token persistence
- granted scope persistence
- refresh metadata persistence
- binding discovery persistence

### New runtime capabilities
- link provider independent of login session lifetime
- resolve active binding by owner + connector provider
- refresh token on demand for resolver requests
- revoke / disconnect linked binding
- report and persist credential health failures

### Session refactor track
`auth` should become BYO-store for sessions too, but this is a **parallel track**, not the same store as linked-provider credentials.

Recommended session contract direction:

```ts
export type AuthSessionStore<TUser> = {
  get(id: string): Promise<AuthSession<TUser> | undefined>;
  set(id: string, value: AuthSession<TUser>): Promise<void>;
  remove(id: string): Promise<void>;
  list?(): Promise<Array<{ id: string; expiresAt: number }>>;
};
```

Planned backends:
- memory
- Redis
- SQL/custom

### Why not reuse the exact `SessionStore` from `absolutejs`
The exported `SessionStore` type in `absolutejs` is useful as a style reference, but `auth` sessions and durable linked-provider grants have different lifecycles and data requirements.

Use the same design philosophy:
- injected persistence contracts
- default memory implementation
- optional Redis / DB implementations

Do not force grants/bindings into a session abstraction.

## Required Changes in `absolutejs`

### New types
Add to `types/ai.ts`:
- linked provider grant/binding-related public types that `absolutejs` must know about
- `LinkedProviderCredentialResolver`
- `ResolvedLinkedProviderCredential`
- `LinkedProviderAccessTokenLease`
- `RAGConnectorRuntime`
- `RAGConnectorCheckpoint`

### New sync source kind
Recommended:
- add `connector` sync source kind

Reason:
- Gmail is not the only target
- social connectors should not all be forced into the existing `email` kind

### New connector runtime layer
Recommended new module area:
- `src/ai/rag/connectors/`

Examples:
- `gmail.ts`
- `x.ts`
- `facebook.ts`
- `instagram.ts`
- `linkedin.ts`
- `types.ts`
- `resolver.ts`

### Sync manager integration
Add:
- `createRAGConnectorSyncSource(...)`

This should:
- resolve credential by binding id
- request token lease through resolver
- run connector sync
- normalize connector items into ingest documents
- persist checkpoints in source metadata

### Keep ingestion provider-agnostic
Connector runtimes should normalize to generic ingest documents:
- messages
- posts
- comments
- profiles
- media
- attachments

The ingestion layer should not learn OAuth or provider-link logic.

## Risks and Blockers

### High risk
- LinkedIn content-read viability is poor compared with Gmail/X/Meta
- Meta permissions and app review can block real-world rollout
- X pricing/access policy may change faster than code

### Medium risk
- grant discovery for Meta is multi-resource and more complex than Google/X
- scope drift requires re-consent flows
- background token refresh requires strong failure-state handling

### Structural risk
- if connector sync is allowed to depend on session cookies, the system will fail for background jobs and multi-node deployments

## MVP Implementation Order

### Step 1
Write durable linked-provider contracts in `auth`:
- grant model
- binding model
- resolver interfaces

### Step 2
Refactor `auth` to store durable linked provider grants separately from sessions

### Step 3
Add session BYO-store contract in `auth`
- memory first
- Redis next

Note:
- do not block connector work on full Redis implementation
- the connector blocker is durable linked grants, not Redis specifically

### Step 4
Add resolver consumption types and connector runtime contract in `absolutejs`

### Step 5
Implement Gmail connector first
- highest viability
- existing email sync client already exists
- fastest path to real connector value

### Step 6
Implement X connector

### Step 7
Implement Meta binding discovery in `auth`
- Pages
- linked Instagram business accounts

### Step 8
Implement Facebook Page connector

### Step 9
Implement Instagram business connector

### Step 10
Implement LinkedIn member-profile connector

### Step 11
If needed, add export/browser-assisted ingestion for:
- LinkedIn content
- unsupported Instagram/Facebook surfaces

## Recommended Immediate Implementation Target
Start with:

1. `auth`
   - durable grant store
   - durable binding store
   - credential resolver
2. `absolutejs`
   - connector runtime contract
   - connector sync source kind
   - Gmail connector

That is the shortest path to a real working connector system without architectural debt.
