# AbsoluteJS E2EE, Secure Transfer, and Verified Agent Exchange: Release Plan

Status: implementation in progress; foundational `0.x` packages and Agent Exchange milestone published
Research snapshot: August 26, 2026

## Implementation checkpoint — August 26, 2026

- Published `@absolutejs/e2ee@0.1.0` and the interchangeable experimental
  `@absolutejs/e2ee-webcrypto@0.1.0` envelope provider from the public
  `absolutejs/e2ee` and `absolutejs/e2ee-providers` repositories.
- Published `@absolutejs/agent-exchange@0.2.0` with exact Agency action binding,
  single-use leases, recipient consent, authenticated E2EE envelopes, replay
  protection, deterministic source/sink boundaries, safe receipts, an opaque A2A
  reference format, and an explicit weakest-link assurance model for approval,
  credential, and execution.
- Published `@absolutejs/agent@0.27.0` with the discoverable
  `@absolutejs/agent/exchange` facade export.
- Published request-bound WebAuthn support in `@absolutejs/auth@0.73.1`, including
  server-side enforcement of required user verification.
- Published `@absolutejs/email@0.3.1` with fail-closed Gmail and Microsoft Graph
  verification lookup in a browser-safe entry point, plus an explicit server-only
  IMAP entry point. Retrieval now requires a mailbox-trusted RFC 8601 authserv-id
  and an exactly aligned DMARC pass, uses provider receipt timestamps, bounds
  windows/body/candidate/header sizes, rejects duplicate code occurrences, and
  fails closed on incomplete provider fetches.
- Published `@absolutejs/agent-exchange-email@0.3.0` from the public
  `absolutejs/agent-exchange-sources` monorepo. It binds the email retrieval layer
  to `SensitiveValueSource`, requires challenge-text correlation by default,
  gates temporal-only correlation behind explicit profile and runtime opt-ins,
  defaults future clock skew to zero, and does not add email to the Agent Exchange
  core or register a model-facing secret tool. It now rejects any request that
  describes an email OTP as stronger than `policy + bearer + purpose-bound`.
- Created the public `absolutejs/agent-exchange-providers` monorepo and published
  `@absolutejs/agent-exchange-webauthn@0.1.0` and
  `@absolutejs/agent-exchange-oauth@0.1.0`. The WebAuthn provider binds approval
  to the exact exchange digest, verifier origin, RP ID, user, credential, UV flag,
  and signature counter. The OAuth provider requires PAR, S256 PKCE, exact issuer
  and resource binding, RAR, one-time state/grants, and DPoP token redemption.
- Upgraded `examples/e2ee` from an architecture simulation to a browser-executed
  Agent Exchange flow and verified the submitted receipt in a headless browser.
- Added canary tests for direct, hexadecimal, base64, and base64url secret leaks;
  tests currently cover package-owned A2A data, source/sink failures, receipts,
  request stores, and Agency inspection. Cross-package prompt, memory, trace, log,
  analytics, notification, inbox, audit, and retry canaries remain release work.
- All new public TypeScript contracts use type aliases; a source-level regression
  test rejects `interface` declarations.

## Executive summary

AbsoluteJS should not position this work as another encrypted messenger or a new
cryptographic protocol. It should become the **secure action and communication
layer for full-stack TypeScript applications—humans and agents, one verified
delegation chain, provider-neutral, self-hostable, with a managed PaaS**.

The release should have three related product layers:

1. `@absolutejs/e2ee` supplies stable protocol, identity, key, envelope,
   attachment, recovery, and provider contracts. Its implementations live in the
   `e2ee-providers` monorepo and remain interchangeable through capability-
   declared adapters.
2. `@absolutejs/conversations` supplies the human-facing 1:1 and group messaging
   product model on top of E2EE, Sync, Blob, Auth, and Devices.
3. `@absolutejs/agent-exchange` supplies verified human-to-agent and
   agent-to-agent requests on top of Auth, Agency, A2A, and E2EE. It is where
   sensitive exchanges such as an email verification code are authorized and
   delivered without exposing the secret to either language model.

The existing AbsoluteJS security stack is the strategic advantage. Auth already
establishes identity and delegation, Agency already grants narrow, expiring,
single-use authority and emits receipts, and A2A already transports agent tasks.
E2EE should protect payloads; it must not create a second identity or permission
ledger.

The long-term cryptographic center should be the IETF Messaging Layer Security
(MLS) standard for asynchronous 1:1 and group conversations. HPKE-style sealed
envelopes are useful for bootstrap, isolated handoffs, and file keys, but should
not become a home-grown messaging protocol. Implementations must be swappable,
versioned, conformance-tested, downgrade-resistant, and independently audited.

The release supports two explicit confidentiality modes:

- `strict-e2ee`: only verified participant devices can decrypt. The service,
  administrators, and recovery provider cannot recover history. Losing every
  verified device and export can mean permanent data loss.
- `managed-recovery`: clients also create encrypted recovery material for an
  explicitly selected recovery authority. The authority and trust consequences
  are shown before creation and remain visible throughout the conversation.

A mode is pinned when a conversation is created. Changing it requires a visible
security event, participant notification, key rotation, and a new security epoch;
there is no silent downgrade.

For sensitive agent automation, the default is `tool-confined`: agents may request
and authorize a value, but the value travels between deterministic trusted tools
and never enters a model prompt, context window, task history, trace, log, memory,
or ordinary message transcript. Visible disclosure remains an explicit weaker
fallback. Legacy one-time codes should be replaced with delegated OAuth, passkeys,
service accounts, or provider-native authorization wherever possible.

## Decisions made by this plan

| Area | Decision |
| --- | --- |
| Core API | New `@absolutejs/e2ee` package |
| Provider source layout | New `e2ee-providers` monorepo, matching `voice-adapters` |
| Human product layer | New `@absolutejs/conversations` package |
| Agent product layer | New `@absolutejs/agent-exchange`, re-exported from `@absolutejs/agent/exchange` |
| Messaging protocol | Standards-first MLS; do not invent an AbsoluteJS ratchet |
| Sealed single-recipient data | HPKE/envelope primitive behind E2EE contracts |
| Confidentiality modes | Both `strict-e2ee` and `managed-recovery`, always explicit |
| Agent secret modes | `tool-confined`, `endpoint-visible`, and opt-in `model-visible` |
| Default agent secret mode | `tool-confined` |
| Identity | Absolute Auth/OIDC account identity plus per-device keys by default; portable identity authorities also supported |
| Interoperability | Provider portability and standards wire interoperability in the complete `0.x` release; federation experimental until stable |
| Paid dependencies | Free adapters are BYO; consumption paid by the application owner or included in a paid Absolute PaaS plan |
| Trust investment | Absolute funds independent audits of the open core; third-party usage fees are not subsidized |
| Post-quantum | Cryptographically agile now; no “quantum-safe” claim until the selected suite, implementation, and standard are audited and stable |
| Server moderation | Metadata controls and voluntary, client-generated report bundles; no hidden content scanning or escrow |

## Product positioning

### Recommended category

> Secure messages and verified actions for humans and agents in full-stack
> TypeScript applications.

The wedge is not chat UI alone. It is the ability to prove who authorized an
agent, what narrowly scoped action it requested, which endpoint received it, that
the protected value was not exposed to a model, and whether the single-use grant
was consumed.

This connects capabilities that competitors usually separate:

- encrypted human conversations;
- encrypted application transfers and attachments;
- authenticated agent-to-agent requests;
- purpose-bound authorization and replay protection;
- safe, model-blind handling of high-risk values;
- web, PWA, native, self-hosted, and managed deployment choices;
- one provider-neutral TypeScript API.

### What AbsoluteJS should not become

- A proprietary cryptographic protocol.
- A consumer messenger that depends on winning a network-effect contest.
- A cryptocurrency or decentralized identity requirement.
- A server-side “encrypted” product in which the service quietly owns every
  decryption key.
- An abstraction that labels materially different provider guarantees as equal.
- A promise that remote managed execution is invisible to the PaaS operator unless
  independently attestable confidential computing actually provides that property.

### Competitive position

| Alternative | Strength | AbsoluteJS response |
| --- | --- | --- |
| Signal/libsignal | Mature secure messaging design | Do not wrap unsupported internals or accept its licensing/support mismatch as the public foundation; use standards and audited providers |
| Matrix | Federated messaging ecosystem and broad SDK support | Interoperate through an adapter if demanded; win on application integration, Agency policy, and human-agent actions rather than operating another federation |
| XMTP | MLS-based, identity-agnostic human and agent messaging with consent and a network | Treat XMTP as an optional provider/transport; do not compete on decentralized network ownership |
| A2A | Standard agent discovery, authentication, tasks, and extensions | Keep A2A as the agent transport; add an Absolute E2EE/secure-exchange extension without replacing A2A |
| MCP | Standard tool access | Use it at the tool boundary, with Auth and Agency deciding whether the tool may act and Agent Exchange protecting results |
| Cloud KMS/HSM products | Strong managed key custody | Offer BYO adapters and managed PaaS integration; do not force one cloud into the core API |

AbsoluteJS wins when an application needs secure communication to participate in
the rest of the application—authorization, data, files, agents, audit evidence,
deployment, and UI—not when it merely needs an isolated chat network.

## What interoperability means

“Interoperability” has four different meanings and the product should name the one
it promises:

1. **Provider portability:** an application keeps the same AbsoluteJS API while
   changing MLS, key-storage, recovery, or transport providers. This is the
   `voice-adapters` model and is mandatory for the complete `0.x` release.
2. **Wire interoperability:** an AbsoluteJS implementation can produce and consume
   standard MLS objects, A2A requests, and documented content types with a
   non-Absolute implementation. This is mandatory where the underlying standard
   is stable.
3. **Network federation:** independently operated services discover and route to
   one another. MIMI, Matrix, or provider networks may supply this, but the abuse,
   discovery, availability, and operations problem is much larger than a crypto
   API. Ship it as experimental/provider-specific initially.
4. **Content portability:** users can export messages, attachments, identities,
   verification evidence, and security-mode metadata in a documented format.
   Include this in the complete `0.x` release without exporting private keys by default.

Provider portability does not imply equivalent security. Every provider publishes
a machine-readable capability and assurance manifest, and initialization fails
when required guarantees are absent.

## Repository and package architecture

### `@absolutejs/e2ee`

The core package owns:

- protocol-neutral TypeScript contracts;
- versioned cipher-suite and content-type identifiers;
- conversation/group lifecycle and state-machine contracts;
- device credential and key-package contracts;
- encrypted envelope and attachment formats;
- key rotation, member add/remove, reinitialization, and recovery contracts;
- provider capability/assurance manifests;
- safe serialization, size, expiry, and replay limits;
- test vectors, conformance harnesses, and deterministic fixtures;
- explicit confidentiality and processing-mode types;
- errors that preserve actionable cause without leaking protected material.

The package must not contain a custom cryptographic primitive, default master key,
global singleton provider, transparent recovery path, or implicit downgrade.

Suggested public subpaths:

```text
@absolutejs/e2ee
@absolutejs/e2ee/mls
@absolutejs/e2ee/envelope
@absolutejs/e2ee/attachments
@absolutejs/e2ee/identity
@absolutejs/e2ee/recovery
@absolutejs/e2ee/testing
```

### `e2ee-providers`

Follow `voice-adapters` exactly at the repository level:

- the root is private and named `@absolutejs/e2ee-providers`;
- each publishable provider is an independently versioned workspace package;
- provider packages peer-depend on `@absolutejs/e2ee`;
- no implementation is imported by the core package;
- every package includes the shared conformance suite and a capability manifest;
- provider-specific dependencies, licenses, limitations, and runtime support remain
  isolated.

The provider contracts should be separated by role even though the implementations share
one monorepo. An MLS engine, key custodian, recovery authority, and delivery
network are not interchangeable things.

All public TypeScript contracts use type aliases rather than interfaces. This is
enforced in package tests so provider capability unions and intersections remain
explicit across the ecosystem.

Initial catalog, subject to the implementation bakeoff:

| Package | Role | Initial status |
| --- | --- | --- |
| `@absolutejs/e2ee-mls-rs` | MLS engine backed by `mls-rs` | Primary candidate, not selected until audit/bakeoff |
| `@absolutejs/e2ee-openmls` | MLS engine backed by OpenMLS | Alternate and cross-implementation reference |
| `@absolutejs/e2ee-webcrypto` | Browser envelope and key operations | Stable only for supported primitives; not presented as a full MLS engine |
| `@absolutejs/e2ee-capacitor` | Native non-exportable key-handle bridge | Stable after iOS/Android device conformance |
| `@absolutejs/e2ee-xmtp` | XMTP network/protocol integration | Optional interoperability provider |
| `@absolutejs/e2ee-aws-kms` | BYO recovery/signing custodian | BYO and paid-PaaS capable |
| `@absolutejs/e2ee-gcp-kms` | BYO recovery/signing custodian | BYO and paid-PaaS capable |
| `@absolutejs/e2ee-azure-key-vault` | BYO recovery/signing custodian | BYO and paid-PaaS capable |
| `@absolutejs/e2ee-vault` | BYO self-hosted custodian | BYO |
| `@absolutejs/e2ee-absolute` | Client for managed Absolute E2EE services | Paid PaaS |

Naming packages by their concrete provider keeps the same recognizable pattern as
`@absolutejs/voice-deepgram` and prevents a generic package from hiding operating
costs or trust assumptions.

### `@absolutejs/conversations`

This package owns application-level messaging:

- 1:1 and group conversations;
- invitations, consent/request inbox, membership, leave, block, and report;
- messages, replies, edits, deletion markers, reactions, receipts, and typing;
- encrypted attachments and secure transfers;
- multi-device history synchronization;
- delivery state and offline outbox behavior;
- security-mode UI state and participant/device verification;
- export and client-generated report bundles.

It consumes E2EE but does not implement cryptography. Secure file transfer begins
as the attachment/transfer domain here and under `@absolutejs/e2ee/attachments`.
A separate `@absolutejs/transfer` product is justified later only if independent
drop boxes, resumable external recipients, or large-data workflows need a separate
lifecycle.

### `@absolutejs/agent-exchange`

This package owns verified sensitive requests between people and agents. It is
also re-exported as `@absolutejs/agent/exchange` so users can discover it through
the existing agent facade.

It composes rather than duplicates:

```text
Auth identity/delegation
        ↓
Agency policy → narrow, expiring, single-use lease
        ↓
A2A task/extension → authenticated request transport
        ↓
E2EE envelope → protected request/result
        ↓
trusted source tool → trusted recipient sink
        ↓
Agency receipt → consumed, rejected, expired, or failed
```

The public request schema binds at minimum:

- requesting user, agent, device, and delegation chain;
- receiving user, agent, device, and endpoint;
- exact purpose, provider, service origin, account, and requested operation;
- challenge or transaction identifier where the upstream system provides one;
- creation time, hard expiry, nonce, idempotency key, and `maxUses: 1`;
- allowed processing mode and output sink;
- response encryption key and expected receipt type;
- policy version and human approval evidence when required.

## Safe email-code and secret exchange

### Security reality

A six-digit email code is usually a bearer authentication result. Manual OTPs are
not phishing-resistant and are vulnerable to real-time relay because the code is
not inherently bound to the intended verifier session. E2EE protects it in
transit, but does not make an overly broad or maliciously induced request safe.

The preference order is:

1. provider-native delegation, OAuth authorization, service account, passkey, or
   another purpose-bound flow with no shareable code;
2. a source tool directly completes the exact authorized upstream operation;
3. a model-blind, purpose-bound code handoff between trusted tools;
4. explicit endpoint-visible disclosure;
5. model-visible disclosure only as an exceptional, warned, policy-controlled
   fallback.

### Processing modes

| Mode | Who can read the value | Product treatment |
| --- | --- | --- |
| `tool-confined` | Deterministic source and recipient tools only | Recommended default; model receives metadata and receipt only |
| `endpoint-visible` | Authorized recipient endpoint/client, potentially the user | Explicit UI and policy; never mislabeled as model-blind |
| `model-visible` | Agent model/provider and everything in its data path | Off by default, high-risk warning, short expiry, no persistence |

The source tool retrieves and parses the email through deterministic,
provider-specific logic. Untrusted email text never becomes agent instructions.
The recipient tool may submit the code only to the authorized origin and operation.
The model sees “request approved,” “submitted,” or a typed failure—not the code.

### Required anti-abuse policy

Automatic exchange is default-deny for:

- password reset or account recovery;
- creating a new authentication factor;
- administrative or privilege elevation;
- money movement or a new payee;
- changing security settings or ownership;
- exporting sensitive data;
- an origin, account, device, or counterparty outside the pre-approved policy.

Low-risk automation can be pre-approved only for an exact paired identity,
service/origin, operation class, expiry, frequency, and value/risk ceiling. Agency
kill switches, rate limits, revocation, receipts, and anomaly rules apply. Unknown
agents enter a request inbox and cannot automatically reach a trusted tool.

Secrets must be excluded by construction from prompts, A2A task history, chat
transcripts, traces, analytics, error strings, audit payloads, crash reports,
telemetry, notifications, clipboards, and durable queues. Conformance tests inject
canary secrets and fail if any forbidden sink observes them.

## Confidentiality and recovery modes

### `strict-e2ee`

- Participant device keys are the only history-decryption authority.
- The delivery service stores ciphertext, ordering metadata, and expiry only.
- New-device history transfer requires an existing verified device or an explicit
  user export/import.
- If all verified devices and exports are gone, old history may be unrecoverable.
- Device removal rotates future access; it cannot erase ciphertext already copied
  by a formerly authorized device.

### `managed-recovery`

- Clients encrypt approved recovery material to the selected recovery authority.
- Recovery policy can require user authentication, organization approval,
  multi-party authorization, delay, notification, or a combination.
- The authority, jurisdiction/provider, scope, and last recovery event stay visible
  in conversation security information.
- A recovery authority is a declared trust participant, not a hidden MLS member.
- Enterprise retention or legal-hold behavior is disclosed before protected
  content is created and cannot be silently enabled later.

### Mode transitions

Changing either mode creates a new security epoch. Clients display the proposed
change, obtain the required approvals, rotate/reinitialize keys, preserve the old
epoch label on historical content, and notify every participant. A client that
cannot meet the new policy stops sending instead of silently weakening security.

If a product needs ordinary server-readable messages, call the mode
`transport-only`; never call it E2EE and never silently fall back to it.

## Identity model: support both

The robust default is account-anchored identity plus per-device credentials:

- Absolute Auth/OIDC establishes an issuer/authority and stable subject.
- Each device creates its own signing and encryption keys.
- Device addition, verification, removal, compromise, and replacement are explicit
  lifecycle events.
- Passkeys/WebAuthn can strengthen account and device enrollment, but an
  authentication credential is not automatically reused as an MLS encryption key.

Portable identity authorities are also valuable and should sit behind an
`IdentityAuthorityProvider` contract. Initial adapters may cover external OIDC,
X.509/workload identity, verifiable credentials, wallets, or other stable
authorities. A portable public key alone is not treated as a durable account
identity because rotation, recovery, naming, and compromise semantics still need
an authority.

This gives AbsoluteJS a strong golden path without locking users to Absolute Auth.

## Cryptographic architecture

### MLS for conversations

Use RFC 9420 MLS for group state, authenticated membership changes, forward
secrecy, and post-compromise security. One-to-one conversations use the same
conversation abstraction, avoiding a separate protocol that later breaks when a
third participant or second device is added.

The delivery service is an untrusted transport. It may order, retain, reject,
duplicate, or withhold ciphertext. Clients authenticate protocol state, detect
invalid transitions, retain bounded state needed for out-of-order delivery, and
surface suspected forks or prolonged inconsistency.

### HPKE/envelopes

Use HPKE-compatible sealed envelopes for narrowly scoped cases such as initial
bootstrap, response encryption, attachment content keys, or isolated capability
delivery. Envelopes include protocol version, suite, sender identity reference,
recipient/key reference, purpose, context binding, expiry, nonce, and authenticated
metadata. They are not a substitute for the MLS conversation state machine.

### Key transparency

The directory that maps people and agents to device credentials can otherwise
equivocate. Build the API around verifiable directory statements from the start.
Ship signed directory snapshots and consistency evidence in the complete `0.x`
release, then graduate
the IETF key-transparency architecture as its standards and ecosystem mature.
High-assurance PaaS deployments should support independent witnesses rather than
asking clients to trust one Absolute-operated log.

### Post-quantum agility

- Every object carries an explicit protocol and cipher-suite identifier.
- Policy defines allowed suites and downgrade behavior.
- Reinitialization can migrate a group to a new suite.
- Stored formats do not assume fixed key/signature sizes.
- Cross-suite transcript binding prevents silent fallback.
- The product does not claim post-quantum safety while the MLS PQ suite remains a
  draft or before the concrete implementation is audited.

### Browser and runtime tiers

Publish runtime assurance rather than claiming every JavaScript environment is
equivalent:

- `native-hardened`: non-exportable OS key handles and app isolation;
- `browser-isolated`: dedicated crypto worker, strict CSP, Trusted Types, dependency
  pinning, no third-party script access, and protected local state;
- `browser-compatible`: exportable key material or weaker isolation, visibly
  documented;
- `server-managed`: keys available to the application process;
- future `attested-managed`: only after real remote attestation and a documented
  memory-confidentiality boundary exist.

WebCrypto is a primitive API, not an application key-management policy. XSS can
act as the user while a page is running, so framework hardening and supply-chain
controls are part of the E2EE threat model.

## Changes to existing packages

| Package | Required release work |
| --- | --- |
| `@absolutejs/auth` | Account/device binding, portable identity authority seam, enrollment and revocation events, stronger delegated authorization bindings |
| `@absolutejs/devices` | Non-exportable key-handle operations, secure backup/transfer hooks, device posture and capability reporting |
| `@absolutejs/agency` | Typed Exchange actions, processing-mode policy, exact-origin/risk rules, single-use lease consumption, kill switches, safe receipts |
| `@absolutejs/a2a` | Registered E2EE/Exchange extension and media types, encrypted artifacts, task-history redaction, caller/recipient binding |
| `@absolutejs/agent` | Re-export `/e2ee` and `/exchange`; preserve one Agency owner and one delegation chain |
| `@absolutejs/agent-inbox` | Protected-payload classification, no-model delivery path, verified target identity, bounded leases and redacted failures |
| `@absolutejs/email` | Least-privilege provider scopes, deterministic verification-message matching/parsing, anti-prompt-injection boundary, no broad inbox exposure |
| `@absolutejs/sync` | Opaque ordered delivery, MLS state convergence rules, offline outbox, duplicate/replay handling, security-epoch separation |
| `@absolutejs/blob` | Streaming ciphertext storage, immutable attachment IDs, range/resume support, size/expiry quotas, ciphertext integrity metadata |
| `@absolutejs/pwa` | Opaque wake-up push only, isolated crypto worker, CSP/Trusted Types templates, offline encrypted-state lifecycle |
| `@absolutejs/audit` | Metadata-safe event schemas, redaction guarantees, policy/receipt hashes, never protected content or secrets |
| `@absolutejs/compliance` | Mode-aware retention/erasure evidence, recovery-authority evidence, export-control checklist, report retention and appeals |
| Absolute CLI | Provider install/config, key/device inspection, security doctor, conformance runner, migration/export, PaaS provisioning |

## Delivery, attachments, notifications, and reporting

### Delivery service

The service stores opaque ciphertext plus the minimum metadata needed for routing,
ordering, quotas, expiry, and abuse defense. It does not receive conversation keys.
Push providers receive an opaque wake-up token or encrypted preview; plaintext
message bodies and codes never appear in notification payloads.

### Attachments and secure transfer

- Generate a fresh content key per attachment.
- Stream-encrypt before upload; never stage plaintext in Blob.
- Bind ciphertext chunks, size, media metadata, conversation/transfer ID, sender,
  and security epoch into authenticated metadata.
- Support resumable upload/download without nonce reuse.
- Perform malware/content checks on the client before encryption where applicable.
- Let recipients scan after decryption before opening.
- Enforce quotas and declared maximum sizes server-side without reading content.
- Delete expired ciphertext and document that recipients may already possess a
  copy.

### Abuse and voluntary reports

E2EE removes server-side content scanning, not the responsibility to operate a safe
service. Include:

- invitation/consent gates and a separate request inbox;
- user, agent, device, tenant, and origin allow/block controls;
- per-sender and per-recipient rate limits, quotas, proof-of-work or friction where
  justified, and privacy-conscious reputation signals;
- immediate device/agent/tenant kill switches;
- client-generated reports that show the reporter exactly which selected messages,
  context, and cryptographic evidence will be disclosed;
- report bundles encrypted to a moderation key, with an immutable receipt,
  retention deadline, access log, and appeal process.

A report never silently uploads an entire conversation or a participant's private
keys.

## Free, BYO, and PaaS boundary

The user's proposed boundary is correct: paid third-party consumption should not
be silently funded for free users.

### Free and open

- `@absolutejs/e2ee`, its wire contracts, test vectors, conformance suite, and at
  least one usable provider;
- `@absolutejs/conversations` and `@absolutejs/agent-exchange` client/application
  contracts;
- self-hostable delivery and directory reference implementations where operating
  them does not impose third-party fees;
- cloud/provider adapters configured with the application owner's credentials;
- local development, export, migration, and security-doctor tooling.

Core security code should use a permissive, auditable license consistent with the
ecosystem. The trust boundary must not depend on obscurity.

### BYO

- cloud KMS/HSM or Vault credentials;
- email provider API credentials;
- Blob/object storage;
- push gateways;
- XMTP/Matrix or another external network;
- external identity, transparency, federation, or moderation services.

Adapters can be free while every billable request is charged to the user's own
provider account.

### Paid Absolute PaaS

- managed mailbox/delivery queues and encrypted Blob storage;
- highly available device/key directory, transparency log, and witnesses;
- managed recovery backed by KMS/HSM and configurable multi-party policy;
- managed push, federation gateway, rate limiting, abuse operations, and reports;
- hosted agent exchange, receipts, policy administration, and tenant kill switches;
- audit/compliance evidence, retention controls, regional placement, backup and
  disaster recovery;
- service limits, monitoring, upgrades, and SLA;
- future confidential/attested execution, sold only with precise guarantees.

Plans include or meter the resulting infrastructure/provider expense. Free users
bring their own paid services.

One intentional exception is security assurance: Absolute should pay for recurring
independent audits, fuzzing, coordinated disclosure, and critical vulnerability
response for the open core. That is not giving away third-party usage; it is the
trust foundation that also makes the paid service valuable.

## Total-release implementation program

This is one complete release commitment with staged integration gates. A stage is
not a public security promise until every applicable exit gate passes.

### Phase 0 — security charter and specifications

- Publish assets, adversaries, trust boundaries, metadata leakage, compromise,
  recovery, malicious-provider, malicious-member, malicious-agent, XSS,
  supply-chain, rollback, fork, and availability threat models.
- Write protocol decision records for MLS, envelope use, identity binding,
  recovery, key transparency, agent secret confinement, and mode transitions.
- Define the compatibility/version policy and cryptographic deprecation process.
- Establish a security response team, private disclosure channel, severity SLA,
  and supported-version window.
- Complete cryptography/export and relevant privacy/regulatory review for launch
  regions.

### Phase 1 — core contracts and provider system

- Create `@absolutejs/e2ee` and the `e2ee-providers` monorepo.
- Define role-specific providers and capability/assurance manifests.
- Build conformance, negative, malformed-input, cross-runtime, and official-vector
  suites before selecting a default implementation.
- Add CLI provider discovery/configuration and `absolute doctor` checks.
- Define stable serialized formats and compatibility fixtures.

### Phase 2 — MLS implementation bakeoff

- Prototype `mls-rs` and OpenMLS in Bun, Node, browsers/WASM, workers, Capacitor
  iOS, and Capacitor Android.
- Measure bundle size, initialization, group operations, large groups, memory,
  state persistence, crash recovery, and out-of-order delivery.
- Cross-test both implementations and official MLS vectors.
- Review licensing, maintenance, unsafe-code surface, audit history, WebCrypto/WASM
  limitations, and update cadence.
- Select the default only after independent cryptographic engineering review.

### Phase 3 — identity, devices, and recovery

- Add account-anchored and portable identity authorities.
- Implement device enroll/verify/remove/replace and key-package publication.
- Add native non-exportable storage and browser assurance tiers.
- Implement `strict-e2ee` device transfer/export.
- Implement `managed-recovery`, multi-party policy, exercises, revocation, and UI.
- Add signed directory statements and consistency evidence.

### Phase 4 — encrypted storage and transfer

- Implement versioned envelopes and streaming attachment encryption.
- Add Blob ciphertext adapters, resumability, expiry, quotas, integrity, and safe
  local scanning seams.
- Build one-time secure transfer and recipient-consent flows within Conversations.
- Test interruption, partial upload, range download, corrupted chunks, replay,
  cancellation, and deletion.

### Phase 5 — conversations and multi-device delivery

- Implement invitations, consent, membership, messages, edits, reactions,
  receipts, block/report, and multi-device history.
- Integrate Sync offline outbox and ordered opaque delivery.
- Add security-mode, device-change, safety/verification, fork, expiry, and recovery
  UX across supported UI frameworks.
- Add opaque push and background/resume reconciliation.
- Exercise concurrent membership changes and long-offline devices.

### Phase 6 — verified agent exchange

- [x] Create `@absolutejs/agent-exchange` and A2A extension/media types.
- [x] Add Agency action schemas, risk classes, exact-origin rules, approvals,
  single-use leases, and receipts; revocation and kill switches are enforced by
  the composed Agency runtime.
- [x] Add deterministic email verification retrieval adapters for Gmail,
  Microsoft Graph, and IMAP through `@absolutejs/email`, then bind them through
  the interchangeable `@absolutejs/agent-exchange-email` source package.
- [x] Require trusted DMARC evidence, provider receipt timestamps, bounded
  retrieval, complete candidate fetches, and unique marker/code occurrences.
- [x] Make challenge-text request correlation the default-safe mode and require
  two explicit opt-ins for weaker temporal-only correlation.
- [x] Implement trusted source and recipient tool APIs with `tool-confined`
  default. The initial receiver intentionally rejects weaker processing modes.
- [ ] Expand redaction/canary tests across A2A, inbox, prompts, memory, traces, logs,
  analytics, notifications, audit, exceptions, and retries.
- [x] Ship request-bound WebAuthn approval and a hardened OAuth grant variant using
  PAR, S256 PKCE, issuer identification, resource indicators, RAR, and DPoP.
  The paired-user verification-code example is implemented, browser-tested, and
  explicitly labeled confidential rather than phishing-resistant.

### Phase 7 — framework, browser, PWA, and native integration

- Add browser isolated-worker runtime and strict CSP/Trusted Types guidance.
- Integrate PWA lifecycle, opaque notifications, IndexedDB state protection, and
  service-worker upgrades.
- Integrate Capacitor iOS Keychain/Secure Enclave and Android Keystore paths.
- Publish components/hooks for every stable AbsoluteJS page framework only after
  its conformance matrix passes.
- Add accessible security explanations and non-color-only mode indicators.

### Phase 8 — PaaS and BYO operations

- Launch managed delivery, encrypted Blob, directory/transparency, recovery,
  push, abuse, audit, and tenant policy services.
- Add tenant isolation, regional controls, quotas, billing, metering, backup,
  restore, migration, export, and deletion.
- Provide equivalent BYO configuration for every third-party paid dependency where
  feasible.
- Document PaaS observability: protected content is absent, but routing/timing/
  account metadata remains visible unless separately minimized.
- Run region-loss, queue-loss, key-directory equivocation, recovery-authority,
  provider outage, and tenant compromise exercises.

### Phase 9 — external interoperability

- Publish MLS/A2A/content profiles and compatibility fixtures.
- Test at least one non-Absolute MLS implementation end-to-end.
- Ship the XMTP provider if its semantics can be mapped without overstating
  guarantees.
- Prototype MIMI discovery/federation behind an experimental flag while drafts are
  changing.
- Publish export/import formats and validate round trips.

### Phase 10 — safety, privacy, compliance, and operations

- Complete consent, report bundles, moderation access, appeals, and abuse runbooks.
- Add data-flow inventory, metadata minimization, retention/erasure behavior,
  recovery evidence, and administrator-boundary documentation.
- Review accessibility, youth/safety implications, enterprise controls, and
  international deployment obligations with qualified specialists.
- Publish an honest security whitepaper and provider assurance matrix.

### Phase 11 — independent assurance

- Independent design and implementation audit of core, selected provider, device
  storage, recovery, agent confinement, and PaaS boundaries.
- Continuous fuzzing of decoders/state transitions and property tests for nonce,
  replay, epoch, and authorization invariants.
- Supply-chain provenance, locked/reproducible builds where practical, signed
  releases, SBOMs, dependency monitoring, and emergency revocation.
- Public coordinated-disclosure and bug-bounty program.
- Remediate all critical/high findings and document accepted lower-risk findings.

### Phase 12 — documentation and launch

- Threat-model-driven guides, not “paste this key” tutorials.
- Quick starts for strict conversation, managed recovery, encrypted attachment,
  paired-agent code handoff, BYO deployment, and paid PaaS.
- Migration, recovery drill, device loss, provider switch, export, incident, and
  deprecation guides.
- Cost calculator that distinguishes free code, BYO provider charges, and PaaS
  charges.
- Add a copyable `~/abs/examples/e2ee` application following the existing examples
  repository's structure, scripts, framework coverage, visual language, README,
  and root catalog entry. It demonstrates explicit provider selection, both
  confidentiality modes, encrypted transfer, and the model-blind verification-code
  workflow without presenting an experimental provider as production-approved.
- Compatibility matrix and precise security claims for every runtime/provider.
- Complete release only when all gates below pass.

## Versioning policy

Every package remains on `0.y.z`; this program never publishes a `1.0.0` release.
Breaking contract changes increment the minor version, compatible fixes and
additions increment the patch version where semver permits, and peer ranges are
pinned to compatible `0.x` minors. Documentation uses assurance labels and release
gates—not a major-version number—to communicate production readiness.

## Total-release gates

The total release is ready only when:

- the threat model and security architecture are public and reviewed;
- one MLS engine passes official vectors, cross-implementation tests, malformed
  input/fuzzing, all supported-runtime tests, and independent audit;
- provider manifests prevent unsupported capability or assurance combinations;
- strict and managed-recovery modes have complete creation, transition, loss,
  revocation, export, and disaster-recovery tests;
- no supported path silently downgrades to transport-only encryption;
- canary secrets never enter any forbidden model or operational sink;
- agent requests are identity-, audience-, purpose-, origin-, expiry-, and
  single-use-bound with deterministic replay tests;
- unknown agents cannot automatically invoke sensitive recipient tools;
- conversation membership and device changes are visible and authenticated;
- attachments pass nonce-reuse, corruption, resumability, range, quota, and
  deletion tests;
- browser, PWA, iOS, Android, Bun, Node, and every advertised framework pass the
  published conformance matrix;
- PaaS tenant isolation, backup/restore, regional failure, billing, deletion, and
  operator-access boundaries are exercised;
- voluntary reports disclose only previewed content and audit every moderator
  access;
- SBOMs, signed releases, security contacts, supported-version policy, incident
  playbooks, and launch-region compliance review are complete;
- all critical and high independent-audit findings are fixed and retested.

## Success measures

- Time for an existing AbsoluteJS app to add a strict encrypted conversation.
- Percentage of integrations using the provider-neutral API with no provider
  imports in application code.
- Provider-switch and content-export round-trip success.
- Percentage of sensitive agent exchanges completed in `tool-confined` mode.
- Zero protected values found by canary leak tests in model/telemetry surfaces.
- Recovery-drill completion and failure rates by declared recovery mode.
- Device compromise/revocation propagation time.
- Abuse request-inbox and report resolution metrics without server plaintext.
- PaaS gross margin after provider consumption, separated from free BYO usage.
- Security findings by severity and median remediation time.

## Research basis

Primary standards and security guidance:

- [RFC 9420: The Messaging Layer Security Protocol](https://datatracker.ietf.org/doc/html/rfc9420)
- [RFC 9750: MLS Architecture](https://datatracker.ietf.org/doc/html/rfc9750)
- [RFC 9180: Hybrid Public Key Encryption](https://datatracker.ietf.org/doc/html/rfc9180)
- [RFC 8693: OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/rfc9700)
- [RFC 7636: Proof Key for Code Exchange](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 9126: Pushed Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9126)
- [RFC 9207: Authorization Server Issuer Identification](https://datatracker.ietf.org/doc/html/rfc9207)
- [RFC 8707: Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707)
- [RFC 9396: Rich Authorization Requests](https://datatracker.ietf.org/doc/html/rfc9396)
- [RFC 9449: OAuth DPoP](https://datatracker.ietf.org/doc/html/rfc9449)
- [RFC 9421: HTTP Message Signatures](https://datatracker.ietf.org/doc/html/rfc9421)
- [NIST SP 800-63B: Authentication and Authenticator Management](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [NIST FIPS 203: ML-KEM](https://csrc.nist.gov/pubs/fips/203/final)
- [IETF MLS post-quantum cipher-suite draft](https://datatracker.ietf.org/doc/html/draft-ietf-mls-pq-ciphersuites)
- [IETF Key Transparency Architecture draft](https://datatracker.ietf.org/doc/draft-ietf-keytrans-architecture/)
- [IETF MIMI documents](https://datatracker.ietf.org/wg/mimi/documents/)
- [A2A Protocol specification](https://a2a-protocol.org/latest/specification/)
- [W3C Web Cryptography Level 2](https://www.w3.org/TR/webcrypto-2/)
- [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)
- [OWASP: Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [NIST: Identity and Authority for Software Agents](https://www.nist.gov/news-events/news/2026/02/new-concept-paper-identity-and-authority-software-agents)

Implementation and ecosystem references:

- [AWS Labs `mls-rs`](https://github.com/awslabs/mls-rs)
- [OpenMLS](https://github.com/openmls/openmls)
- [Signal `libsignal` repository and usage notice](https://github.com/signalapp/libsignal)
- [XMTP documentation](https://docs.xmtp.org/)
- [XMTP decentralization model](https://xmtp.org/decentralization)
- [Matrix end-to-end encryption overview](https://matrix.org/docs/matrix-concepts/end-to-end-encryption/)
- [EU Digital Markets Act messaging interoperability portal](https://digital-markets-act.ec.europa.eu/developer-portal/messaging-interoperability_en)

These references guide the architecture; they do not substitute for the release's
own threat model, implementation review, audits, legal review, or runtime-specific
conformance evidence.
