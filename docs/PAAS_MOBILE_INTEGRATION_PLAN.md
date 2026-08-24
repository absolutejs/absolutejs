# AbsoluteJS PaaS mobile integration plan

Status: planning handoff only. This document does not authorize or begin PaaS
implementation.

## Purpose

AbsoluteJS already supports local Android development and local or remote iOS
development through a developer-owned Mac. The hosted platform should turn that
same workflow into an optional managed service:

- Bring your own Mac remains free infrastructure for AbsoluteJS and gives users
  full control.
- AbsoluteJS PaaS offers hosted Mac capacity when a user has no Mac, wants a
  browser-accessible Simulator, needs CI/release automation, or wants a team to
  share a consistent environment.
- `bun dev` remains the entry point. Selecting PaaS must not create a second
  mobile framework, configuration model, or source layout.
- Applications keep working as normal AbsoluteJS applications. The hosted layer
  supplies execution, connectivity, artifacts, and managed services; it does
  not require authors to write Swift, edit Xcode projects, or call raw PaaS APIs.

The PaaS opportunity is larger than renting a remote Mac. It can connect the
entire mobile lifecycle—development, preview, builds, signing, release channels,
backend compatibility, auth, sync, push, deep links, telemetry, and store
delivery—to the application deployment that already serves the mobile app.

## Product position

AbsoluteJS should present one mobile development experience with multiple
execution providers:

| Provider | Who operates it | Best use | Business model |
| --- | --- | --- | --- |
| Local Mac | Developer | Fastest iOS development for a Mac user | Framework feature |
| Bring-your-own remote Mac | Developer/team | Windows or Linux development using an owned Mac | Framework feature; no hosted compute cost |
| AbsoluteJS hosted Mac | AbsoluteJS PaaS | No Mac, team environments, browser preview, CI, signing and releases | Metered/plan-included PaaS feature |
| Dedicated hosted Mac | AbsoluteJS PaaS for one customer | Regulated workloads, predictable performance, persistent signing constraints | Premium reserved capacity |

The headline should be: **develop a real iOS app from any computer with the same
`bun dev` workflow**. “Remote Mac” is an implementation detail. The user should
primarily see a device target, its readiness, HMR latency, logs, and cost state.

The PaaS must not imply that Apple tooling runs on Windows or Linux. Xcode and
the iOS Simulator still execute on Apple hardware. AbsoluteJS removes the need
for that hardware to be physically attached to the developer.

## What exists in AbsoluteJS today

The hosted design should reuse the implementation documented in
[REMOTE_IOS_DEVELOPMENT.md](./REMOTE_IOS_DEVELOPMENT.md), not replace it.

### Existing developer experience

- `absolute mobile pair mac <name> <destination>` verifies a user-owned Mac.
- `bun dev` automatically chooses a paired Mac on a non-macOS development host.
- `absolute mobile doctor ios --remote <name>` diagnoses Bun and Xcode remotely.
- `absolute mobile remotes` and `unpair` manage local connection profiles.
- The existing interactive dev session reports device state, supports relaunch,
  forwards native logs, and closes cleanly with the web dev server.
- Ordinary page, component and CSS edits use the normal HMR path.
- Native-affecting changes synchronize the project and rebuild only when needed.
- Native project and DerivedData caches remain warm between sessions.

### Existing execution protocol

The shipped remote-Mac implementation already provides a useful provider-neutral
execution core:

1. AbsoluteJS materializes a self-contained remote agent from the installed
   `@absolutejs/absolute` package.
2. The agent is content-addressed by SHA-256 and scoped by protocol version.
3. A missing agent is uploaded atomically and verified before execution.
4. The project is uploaded into a staging directory and atomically promoted.
5. `node_modules`, `.absolutejs` state, native fingerprints, installed-app state,
   and DerivedData can survive project snapshots.
6. The agent starts the existing iOS Simulator controller on macOS.
7. A versioned JSON-lines protocol reports state, logs, native logs, phase
   timings, readiness, cache hits, Simulator identity, command responses, and
   fatal errors.
8. The controller accepts `rebuild`, `relaunch`, `screenshot`, and `close`.
9. A reverse SSH tunnel makes the Simulator's loopback development URL reach
   the developer's local AbsoluteJS server.

The current protocol is version `1`. Its wire events and command semantics are
valuable contracts. SSH, local profile files, and direct tar streaming are
provider-specific transports around those contracts.

### Existing security properties

- The developer's SSH implementation owns keys and host verification for BYO
  Macs; AbsoluteJS never stores SSH passwords or private keys.
- Agent code is protocol-versioned, content-addressed, and digest verified.
- Application paths and command arguments are validated and shell quoted.
- Remote workspaces use a hashed project identity rather than the local path.
- Signing identities and Keychain material stay on a BYO Mac.
- Logs use AbsoluteJS redaction.
- Telemetry records platform, provider, phase timings and cache outcomes without
  SSH destinations, usernames, paths, app IDs, or Simulator UDIDs.

These are minimum properties for PaaS, not a complete hosted threat model.

## Architectural rule: separate contract, transport, and provider

The current implementation should be evolved into three explicit layers before
or while adding a hosted provider:

```text
AbsoluteJS dev/session contract
  state, timings, logs, rebuild, relaunch, screenshot, close
                         |
Remote agent protocol
  version negotiation, commands, events, error codes, capabilities
                         |
Provider transport
  local process | BYO SSH | PaaS authenticated relay
```

Provider selection must not leak through the public session interface. The iOS
controller and CLI should not care whether bytes travel through SSH or an
AbsoluteJS relay.

The self-contained agent must remain an AbsoluteJS artifact. A hosted runner
must never locate it through an application's `node_modules/.bin`, global PATH,
or a mutable machine installation. The control plane selects an allowed agent
digest for the requested AbsoluteJS version, and the runner verifies that digest
before executing it.

## Target hosted development flow

```text
developer computer              AbsoluteJS PaaS                 Mac runner
------------------              ----------------                ----------
editor + bun dev                identity/project auth           Xcode
web/HMR server        WSS       session control                  iOS Simulator
CLI session client  <-------->  tunnel broker       <-------->  runner + agent
source snapshot       HTTPS     encrypted artifacts              warm caches
logs/timings/viewer  <--------  event/view relay    <-------->  video + input
```

All long-lived connections are outbound from the developer and runner. No user
must expose a local port, configure a router, disable a firewall, or distribute
an SSH key to AbsoluteJS.

### User journey

1. The user signs into the AbsoluteJS CLI with `absolute login` or the eventual
   equivalent shared PaaS identity command.
2. `absolute mobile doctor ios` detects that local Xcode and a BYO Mac are
   unavailable and offers the hosted provider if the account is entitled.
3. The user chooses a Simulator model/runtime or accepts the project default.
4. `bun dev` requests a hosted iOS development session.
5. The control plane returns a session ID, short-lived client credentials,
   upload instructions, and a relay endpoint.
6. The CLI sends a source snapshot or delta. It never sends ignored files,
   local `.absolutejs` state, unrelated workspace services, or secrets that do
   not belong in the native build.
7. The scheduler leases a compatible Mac runner and prepares a tenant-isolated
   workspace.
8. The runner restores safe caches, installs the verified agent, materializes
   the project atomically, and starts the Simulator controller.
9. The Simulator loads its loopback development origin. A runner-side tunnel
   carries that request through the PaaS relay to the developer's local HMR
   server.
10. The terminal prints the same native state, logs, cache result, and phase
    timings as local/BYO development.
11. The PaaS dashboard or CLI opens a low-latency Simulator viewer with mouse,
    keyboard, touch, rotation, paste, and common hardware controls.
12. Web-only edits stay local and flow through HMR. Native-affecting edits upload
    an incremental snapshot and call `rebuild` on the same warm session.
13. Ctrl-C closes relays and metering, flushes permitted cache metadata, scrubs
    tenant data from ephemeral locations, and returns the runner to the pool.

The first hosted session may be slower. The CLI should explain each measured
phase rather than showing an indefinite spinner. Subsequent sessions should
reuse a compatible warm environment when policy permits.

## PaaS control-plane responsibilities

The PaaS owns orchestration and commercial policy. AbsoluteJS core owns build and
runtime semantics.

The control plane should provide:

- Account, organization, project and environment authorization.
- Provider entitlement, quota, concurrency, budget and regional policy.
- Session creation, idempotency, heartbeats, cancellation and expiry.
- A scheduler for macOS runtime, Xcode, architecture, device and isolation needs.
- Short-lived, single-session credentials for every client and runner channel.
- Agent protocol and AbsoluteJS-version compatibility negotiation.
- Snapshot manifests, digest validation, upload authorization and retention.
- Relay allocation for HMR, command/event traffic and viewer traffic.
- Runner registration, health, draining, image version and capacity inventory.
- Metering records derived from authoritative session state.
- Audit events for session, build, signing, release and operator access.
- Mobile artifact/release records associated with the deployed application.

The control plane should never inspect source merely to schedule it. Scheduling
uses declared metadata and digests. Any source-processing service must be
explicitly part of the build plane and subject to the project's retention and
region settings.

## Mac execution plane

### Capacity model

Do not leave one Mac permanently running per ordinary user. Use a scheduler over
a pool of Apple-hardware-backed runners:

- Shared plans lease an isolated runner or isolated macOS execution environment
  for a bounded session.
- Warm pools keep a limited number of ready environments by Xcode/runtime image.
- Dedicated plans reserve a host or pool for one organization.
- Burst and CI capacity can use a supported external Mac provider behind the
  same runner contract.
- Provider selection is an internal scheduling decision unless locality,
  compliance or dedicated tenancy makes it user-visible.

Before choosing virtualization or a cloud vendor, legal and infrastructure work
must validate current Apple licensing, Apple-hardware requirements, nested
virtualization constraints, Simulator acceleration, image distribution rights,
and provider tenancy guarantees.

### Runner image

Each runner image should be immutable and identify:

- macOS version and build;
- Xcode version and selected developer directory;
- installed Simulator runtimes and base devices;
- Bun version range;
- CocoaPods/Swift Package/Capacitor prerequisites where supported;
- AbsoluteJS runner bootstrap version;
- security patch and image creation timestamp.

The AbsoluteJS application agent remains uploaded/selected per framework
version. It should not be baked into the image as an unversioned global tool.

### Isolation

Every session gets a unique, unguessable identity and a workspace unavailable to
other tenants. Minimum requirements:

- no cross-tenant writable cache;
- cache keys include organization/project, lockfile digest, native fingerprint,
  platform, architecture, Xcode/runtime image and agent protocol;
- restored caches are validated and treated as untrusted build input;
- per-session Keychain and Simulator/device state;
- outbound network policy and DNS logging appropriate to the plan;
- resource limits and watchdogs for CPU, memory, disk and child processes;
- reliable cleanup after success, cancellation, runner crash and host reboot;
- quarantine/drain behavior when cleanup cannot be proven;
- no operator shell by default, with audited break-glass access if ever offered.

The exact boundary—full host, VM, or another Apple-supported isolation
mechanism—must be threat-modeled and benchmarked. A Unix account and directory
alone are not sufficient for hostile multi-tenant source builds.

## Transport and relay design

### Session channels

Use separate logical channels even if they multiplex over one authenticated
connection:

1. **Control:** lifecycle, heartbeats, cancellation and capability negotiation.
2. **Agent:** versioned commands and events already represented by protocol v1.
3. **HMR/data plane:** byte forwarding between Simulator loopback and the local
   AbsoluteJS dev port.
4. **Source/artifacts:** resumable object uploads and downloads by digest.
5. **Viewer:** video, audio if enabled, input and device controls.

A slow viewer must never block HMR or agent heartbeats. Native log pressure must
not starve command responses. Each channel needs explicit size, rate and queue
limits.

### HMR relay

The hosted equivalent of reverse SSH forwarding should work as follows:

- The CLI opens an outbound authenticated connection and registers one local
  development port for one session.
- The runner opens its own outbound authenticated connection for the same
  session.
- A listener bound only inside the runner makes the Simulator's configured
  `localhost:<port>` reach the matched CLI stream.
- The broker validates organization, project, session, direction and expiry on
  both halves.
- Session credentials cannot enumerate or join other sessions.
- Backpressure, half-close, reconnect and idle behavior preserve HTTP,
  WebSocket/HMR, streaming responses and useful error reporting.
- Reconnect should resume a live session when safe without reallocating the Mac.

The existing AbsoluteJS tunnel relay may provide reusable framing or operational
lessons, but hosted mobile must have tenant-aware authentication, authorization,
limits and observability. A development token from another feature must not be
reused as a universal mobile session secret.

### Source transfer

The BYO protocol currently sends an excluded tar snapshot and atomically swaps
it. Hosted transfer should preserve atomic materialization while improving
bandwidth and recovery:

- Build a deterministic manifest of relative path, mode, size and digest.
- Reject absolute paths, traversal, special devices, unexpected symlinks and
  case-collision hazards before upload and materialization.
- Negotiate missing blobs by digest so unchanged native/project files are not
  resent.
- Upload blobs with short-lived signed authorization and resumable semantics.
- Construct a staging tree, validate the manifest, then atomically promote it.
- Keep dependency/native caches outside the source tree and restore them only by
  validated cache keys.
- Encrypt stored blobs and use per-project or per-organization access control.
- Delete source blobs and snapshots according to an explicit retention policy.

The initial hosted MVP may use compressed full snapshots if size limits and
timings are acceptable, but the API should already model a manifest so delta
transfer can replace it without changing the CLI/session contract.

## Simulator viewer

A hosted Mac product needs a first-class viewer; asking a PaaS customer to set up
VNC defeats the managed experience.

The viewer should provide:

- low-latency video suitable for interactive development;
- pointer-to-touch mapping, multi-touch shortcuts and keyboard input;
- rotation, shake, home/lock and common Simulator controls;
- clipboard and safe text paste with opt-out policy;
- screenshot and failure-artifact capture using the existing agent command;
- visible device/runtime/app-build/session information;
- accessibility-tree inspection in a later phase;
- reconnect without restarting the dev session;
- team viewing with explicit viewer/controller roles;
- watermarks and recording controls for higher-security plans.

WebRTC is the likely interactive transport, with an authenticated WebSocket
fallback for control and screenshots. The implementation choice must be proven
against latency, NAT traversal, browser compatibility, input accuracy, CPU cost
and tenant isolation before commitment.

Viewer media and input require separate authorization from source/build access.
Viewing must never silently grant terminal, signing or deployment permissions.

## Mobile-aware PaaS platform integration

Hosted Mac execution is the first wedge. The durable advantage is making the
deployed AbsoluteJS backend understand and operate its mobile clients.

### Application and environment model

The PaaS should add mobile records adjacent to an existing AbsoluteJS project and
environment, not create an unrelated “mobile project.” A mobile target needs:

- app ID/bundle ID and platform;
- native runtime and protocol compatibility;
- mobile manifest/app-build identity;
- page bundle and page-contract identities;
- production origin and environment;
- deep-link domains and association status;
- auth public-client registration;
- sync schema/protocol version where enabled;
- native capability/plugin fingerprint;
- signing/release channel metadata;
- store application identifiers;
- minimum supported and rollout versions.

The production server remains the authority for routes, data, secrets and
business logic. The installed Capacitor app contains the native shell, compiled
UI/runtime and assets. It does not contain Bun, Elysia, databases or server
secrets.

### Deployment compatibility

AbsoluteJS mobile page requests carry app/runtime/page contract metadata. The
PaaS deployment system should use that data to prevent a backend deployment from
silently breaking installed clients:

- Store the compatibility manifest alongside each application deployment.
- Track released app builds and active release channels.
- Run compatibility checks before promotion.
- Retain or route to generated compatible producers for supported old clients.
- Define an explicit support/retention window and show its storage/compute cost.
- Block destructive contract removal unless the operator confirms a coordinated
  minimum-app-version change or migration.
- Expose incompatible and soon-to-expire clients in deployment health.
- Let server rollbacks restore the associated compatibility manifest.

Type-safe page props help source authors at build time; they do not update an
already installed binary. The platform must automatically derive contracts and
track them. Users should not manually version every prop shape.

### Web-content and native release distinction

The PaaS must distinguish two update classes:

- Page/UI/data-compatible web bundle changes may use AbsoluteJS's versioned
  mobile bundle/release mechanism when store policy and the app's declared
  native capability fingerprint permit it.
- Swift/Kotlin code, Capacitor plugin, entitlement, permission, native SDK,
  signing or other native-capability changes require a new native build and
  store distribution.

The release service should calculate this distinction from manifests and fail
closed. It must not encourage users to bypass Apple or Google review rules.

### Managed auth

PaaS should integrate the mobile client support in `@absolutejs/auth`:

- generate/register public installed-app clients per environment;
- use system-browser authorization with PKCE and app/universal-link callbacks;
- never depend on sharing a WebView cookie with the system browser;
- store mobile credentials through the device adapter/secure storage;
- normalize web-cookie and mobile-token identities to the same server principal;
- manage redirect URIs, logout callbacks, key rotation and revoked-device flows;
- surface auth/deep-link conformance in deployment and release doctor results.

Hosted development should use development registrations distinct from
production App Store clients.

### Managed sync and offline data

`@absolutejs/sync` should remain the framework-level contract for both web and
mobile. PaaS can supply the managed production adapter:

- provision durable sync storage and server endpoints;
- deploy generated pack definitions and migrations with the application;
- enforce account/tenant partitioning and authorization server-side;
- track schema and protocol compatibility across installed app builds;
- expose conflict, retry, queue-depth and stale-client observability;
- trigger durable server jobs only after accepted sync writes;
- support IndexedDB on web and SQLite/native storage on Capacitor behind the
  same app-facing APIs;
- correctly purge or lock private local state on logout, user switch, tenant
  switch and device revocation.

PaaS integration must not move server synchronization logic into the Mac runner.
The runner is development/build infrastructure; sync is an application runtime
service.

### Push notifications and background work

After the core hosted-development path is stable, PaaS can offer:

- APNs/FCM credential and environment management;
- device-token registration tied to the normalized auth principal;
- typed notification payloads and deep-link targets;
- segmentation, scheduling, retries and delivery telemetry;
- development push testing against the active Simulator/device where supported;
- background-sync wake hints while preserving foreground/resume correctness.

The platform must not promise exact background execution times. iOS and Android
remain the schedulers.

### Deep links and association files

Because the PaaS controls deployment domains, it can make deep links unusually
easy:

- derive AASA and `assetlinks.json` from mobile configuration and signing IDs;
- serve them with exact paths, content types, cache policy and no redirects;
- validate production reachability before store release;
- connect auth callbacks and notification links to the same route manifest;
- support preview environments without accidentally claiming production domains.

### Builds, signing and stores

The hosted build service should eventually support:

- reproducible debug, ad hoc, internal and store builds;
- content-addressed IPA and metadata records;
- release channels, notes and approval state;
- App Store Connect/TestFlight upload using the existing AbsoluteJS release
  semantics;
- Play Console delivery for Android, even though Android builds do not require a
  Mac;
- signed provenance linking source/deployment, agent, runner image, lockfile,
  native fingerprint and output digest;
- retries that never create duplicate logical releases;
- customer-controlled approval before external submission.

Signing credentials require a dedicated design:

- prefer App Store Connect API keys or narrowly scoped automation identities;
- encrypt credentials with organization-scoped keys and audit every use;
- materialize secrets only into an ephemeral per-build Keychain;
- never include credentials in snapshots, logs, caches or artifacts;
- support customer-managed signing and BYO-Mac signing where hosted custody is
  unacceptable;
- separate permission to edit credentials, build, sign, upload and release.

## Proposed service boundaries

Names are illustrative; the PaaS can fit these responsibilities into its current
service architecture.

| Service | Responsibility |
| --- | --- |
| Mobile session API | Authenticated session lifecycle, entitlement, quotas and idempotency |
| Mac scheduler | Runner/image/capacity selection, leases, heartbeats and draining |
| Runner gateway | Runner registration and short-lived runner credentials |
| Session relay | Multiplexed control, agent events and HMR byte streams |
| Snapshot service | Manifests, missing-blob negotiation, uploads and retention |
| Viewer gateway | Media negotiation, input authorization and collaborative roles |
| Mobile build service | Reproducible native builds, provenance and artifact creation |
| Signing service | Ephemeral Keychain materialization and tightly scoped secret access |
| Mobile release service | Channels, compatibility, TestFlight/store delivery and approvals |
| Mobile deployment integration | Backend/mobile manifest compatibility and retained producers |
| Managed sync adapter | Durable sync runtime, schema rollout and observability |
| Mobile telemetry pipeline | Privacy-filtered timings, failures, usage and cost attribution |

Do not make the Mac scheduler the owner of builds, releases, sync or deployment
compatibility. A runner executes a lease; durable product state lives in the
appropriate control-plane service.

## Initial API shape

Exact paths should follow PaaS conventions, but the resource model should cover:

```text
POST   /projects/:project/mobile/sessions
GET    /projects/:project/mobile/sessions/:session
DELETE /projects/:project/mobile/sessions/:session
POST   /projects/:project/mobile/sessions/:session/heartbeat
POST   /projects/:project/mobile/sessions/:session/snapshots
POST   /projects/:project/mobile/snapshots/:snapshot/missing-blobs
POST   /projects/:project/mobile/builds
GET    /projects/:project/mobile/builds/:build
POST   /projects/:project/mobile/releases
POST   /projects/:project/mobile/releases/:release/promote
GET    /projects/:project/mobile/compatibility
```

Session creation input should include only schedulable declarations: project and
environment identity, platform, device/runtime request, AbsoluteJS and agent
protocol version, mobile/native fingerprint, snapshot manifest digest, desired
viewer capability, and an idempotency key.

Session output should use opaque URLs and short-lived credentials for snapshot
upload, CLI relay, viewer and status. It must not reveal runner hostnames,
internal IP addresses, filesystem paths or other tenants.

### Session state machine

```text
requested
  -> waiting_for_capacity
  -> provisioning
  -> waiting_for_snapshot
  -> preparing
  -> booting_simulator
  -> ready
  -> rebuilding (returns to ready)
  -> closing
  -> closed

Any active state -> failed | cancelled | expired
```

Each transition has a stable machine-readable reason and timestamp. Retrying a
session-creation idempotency key returns the same logical session. A runner loss
may reconnect/recover only when the protocol proves it safe; otherwise the
control plane fails the session explicitly and offers a one-command restart.

## CLI and configuration direction

Provider choice should be optional and environment-overridable. An eventual
shape could be:

```ts
export default defineConfig({
  mobile: {
    appId: 'com.example.app',
    appName: 'Example',
    development: {
      ios: {
        provider: 'auto', // local -> paired Mac -> PaaS
        device: 'iPhone 17 Pro'
      }
    },
    platforms: ['ios', 'android'],
    server: {
      productionOrigin: 'https://app.example.com'
    }
  }
});
```

This is a direction, not an approved config change. Account, billing, tokens,
regions and secret values do not belong in `absolute.config.ts`.

Useful commands may include:

```text
absolute mobile providers
absolute mobile doctor ios --provider paas
absolute mobile dev ios --provider paas
absolute mobile sessions
absolute mobile session stop <id>
absolute mobile build ios --provider paas
absolute mobile publish ios --build <id> --channel internal
```

Normal `bun dev` remains the preferred path. Explicit commands support CI,
diagnostics and unusual workflows.

The CLI should show cost-relevant behavior before allocation: expected billing
unit, included quota, idle timeout, queue state and whether stopping the terminal
stops billing. It should never create paid dedicated capacity through an
ambiguous yes/no prompt.

## Cost and commercial model

Mac capacity is expensive and has low elasticity compared with ordinary Linux
compute. The product must meter the resource users understand and control.

Recommended model:

- BYO remote Mac: no PaaS compute charge.
- Hosted development: active Mac session minutes, with a short configurable idle
  grace period and plan-included monthly allowance.
- Hosted CI builds: per build-minute or per build, separated from interactive
  sessions.
- Warm-cache storage and retained artifacts: included allowance plus storage
  overage.
- Dedicated runners: monthly reserved price plus optional burst usage.
- Viewer relay bandwidth: initially included, measured separately before pricing.

Metering starts only when capacity is leased and ends authoritatively when the
lease closes or expires—not when a browser tab happens to disconnect. The CLI
and dashboard need stop controls, idle countdown, budget alerts and hard caps.

Capacity protections:

- organization concurrency limits;
- per-user session limits;
- bounded idle and maximum session duration;
- queue cancellation and fair scheduling;
- budget ceiling and usage alerts;
- automatic cleanup on lost heartbeats;
- abuse detection without collecting application content.

## Observability and telemetry

Reuse the native timing vocabulary already emitted by AbsoluteJS and add hosted
phases without mixing them into one opaque number:

- session request and queue wait;
- runner allocation/image preparation;
- agent cache hit/upload/verification;
- snapshot diff, upload and materialization;
- dependency cache/install;
- Xcode/native cache result;
- Simulator boot/install/launch;
- HMR relay round-trip and end-to-end update time;
- native rebuild time;
- viewer connect/reconnect latency;
- session close and cleanup;
- build/sign/upload/store-processing stages.

Logs should correlate by opaque session/build IDs. User-visible logs should
retain AbsoluteJS redaction. Platform telemetry must not include source, local or
runner paths, user SSH details, bundle ID, device UDID, tokens, signing values or
application payloads by default.

Dashboards should answer:

- Where is hosted startup time spent?
- How often do warm agent/dependency/native caches hit?
- What is p50/p95 HMR latency by region and runner image?
- Which Xcode/runtime images fail or queue most often?
- How many sessions end through Ctrl-C, idle expiry, runner loss or failure?
- Which build failures are user code, toolchain, capacity or platform faults?
- What is Mac utilization and margin by plan?

## Security threat model checklist

Before external beta, explicitly test and review:

- cross-tenant snapshot/blob/cache access;
- session credential replay and relay session joining;
- malicious tar/manifests, traversal, symlinks, case collisions and file bombs;
- hostile build scripts and dependency lifecycle scripts;
- runner-to-control-plane impersonation;
- compromised or stale runner images;
- secrets in stdout, native logs, crash reports, screenshots and recordings;
- signing credential exfiltration and unauthorized store uploads;
- unauthorized viewer/input access;
- source/artifact retention after cancellation, failure and account deletion;
- denial of service through disk, process, Simulator, network or log exhaustion;
- SSRF and access to cloud metadata/control-plane networks from builds;
- supply-chain verification for the AbsoluteJS agent and runner bootstrap;
- operator access, audit integrity and emergency response.

Run untrusted tenant builds in a boundary designed for code execution. Do not
depend on application cooperation.

## Delivery phases

### Phase 0: contract extraction and proof

AbsoluteJS work:

- Extract a provider-neutral remote session/transport interface without changing
  local or BYO behavior.
- Freeze/version command, event, capability and error envelopes.
- Add protocol negotiation and explicit unsupported-version errors.
- Preserve current native logs, state, timing, cache and screenshot behavior in
  provider conformance tests.

PaaS proof work:

- One manually provisioned Mac runner.
- Authenticated control/session API and two-ended relay.
- Full snapshot upload and atomic materialization.
- Start, HMR, native log, relaunch, screenshot and close from a non-Mac client.
- Measure first-start, warm-start and HMR latency.

Exit gate: the same test suite runs against BYO SSH and PaaS transport, with no
application source or route changes.

### Phase 1: private hosted development alpha

- Account/project authorization and plan entitlement.
- Small fixed Mac pool with immutable versioned images.
- Session state machine, heartbeats, cancellation and cleanup.
- CLI login/provider selection and `bun dev` integration.
- Full snapshot transfer with documented size limits.
- Terminal state/log/timing parity and screenshot artifacts.
- Basic authenticated browser viewer or a deliberately limited screenshot/input
  preview if interactive streaming is not yet ready.
- Usage metering in shadow mode; no surprise billing.

Exit gate: internal users can develop an existing AbsoluteJS Capacitor iOS app
from Windows/Linux through normal `bun dev` for a full workday, reconnect, and
leave no recoverable tenant state on a released runner.

### Phase 2: hosted development beta

- Warm pools, fair scheduling, quotas, idle timeouts and visible billing.
- Digest manifest/delta source transfer and resumable uploads.
- Production-quality interactive viewer and team roles.
- Cache policy, encryption, retention and regional controls.
- Automatic runner health/drain/replacement.
- Support diagnostics and platform dashboards.
- External security review and fault-injection exercises.

Exit gate: defined startup/HMR SLOs, proven tenant isolation and bounded cost at
the intended beta concurrency.

### Phase 3: hosted build and TestFlight

- Content-addressed hosted iOS builds with provenance.
- Signing service and ephemeral Keychains.
- Build/release permissions and audit log.
- TestFlight upload, groups, notes, retries and approval workflow.
- Artifact retention and download.
- CI/non-interactive API and status webhooks.

Exit gate: a clean hosted build can be reproduced, audited, uploaded once under
retry, installed from TestFlight and traced back to source/deployment manifests.

### Phase 4: mobile-aware deployments

- Mobile build/manifest records adjacent to PaaS deployments.
- Automatic page-contract compatibility checks and retained producers.
- Native-capability versus web-bundle update classification.
- Deep-link association hosting/verification.
- Managed mobile auth registrations.
- Release health by app build/runtime/protocol.

Exit gate: PaaS prevents an incompatible backend promotion and safely supports a
declared window of already-installed app versions without manual prop versioning.

### Phase 5: managed mobile services

- Managed `@absolutejs/sync` adapter and migration/compatibility operations.
- Push notification credentials, typed sends and delivery telemetry.
- Crash/error symbolication tied to app-build and page-bundle identities.
- Physical-device testing partners or device-farm integration if justified.
- Expo/React-native build execution only after the configurable Expo engine in
  AbsoluteJS core has its own stable provider contract.

Capacitor remains the default and first supported hosted engine. Do not let Expo
delay the all-framework Capacitor experience.

## Validation matrix

Every hosted release should test at least:

- Windows CLI -> PaaS Mac -> iOS Simulator;
- Linux CLI -> PaaS Mac -> iOS Simulator;
- macOS CLI explicitly selecting PaaS;
- cold and warm runner/cache paths;
- first full snapshot and incremental native rebuild;
- React, Vue, Svelte, Angular and supported non-React page paths as they enter the
  mobile conformance matrix;
- HMR for component, CSS and public asset edits without native rebuild;
- native rebuild for Capacitor/plugin/config/entitlement/lockfile changes;
- disconnect/reconnect, client crash, runner crash and control-plane restart;
- relaunch, screenshot, native logs and phase timings;
- two simultaneous tenants with adversarial cache/snapshot identifiers;
- session expiry, budget cap and cancellation during every lifecycle phase;
- old installed app contract against a newly promoted backend;
- development and production mobile auth callbacks;
- signing/build retry without duplicate release;
- complete cleanup and credential revocation.

Performance gates should be stated as percentile targets after the Phase 0 proof
collects realistic baselines. Do not invent SLOs before measuring Mac allocation,
Simulator boot, source upload and viewer latency separately.

## Ownership boundary

### AbsoluteJS repository owns

- mobile config and generated native-project semantics;
- page/data/compatibility contracts;
- Capacitor and eventual Expo engine behavior;
- local, BYO and provider-neutral dev session interface;
- remote agent commands/events and agent artifact production;
- native fingerprint/rebuild rules;
- framework HMR behavior, logs and timing semantics;
- auth/sync/device package contracts;
- CLI provider integration and user-facing diagnostics;
- conformance fixtures usable by every provider.

### PaaS repository owns

- identity, organization/project authorization and billing;
- hosted-session API and durable state;
- Mac runner fleet, images, scheduler and isolation;
- authenticated relay and viewer infrastructure;
- snapshot/blob storage and retention;
- hosted build/sign/release services;
- deployment compatibility storage and promotion policy;
- managed sync/auth/push/deep-link operational adapters;
- hosted telemetry, audit and support tooling.

### Shared versioned contracts

- remote agent protocol and capabilities;
- session lifecycle/reason codes;
- mobile build/compatibility manifest schema;
- source snapshot manifest schema;
- native capability fingerprint;
- telemetry phase names and privacy classification;
- artifact provenance envelope.

Shared contracts should live in one publishable source of truth or generated
schema, with compatibility tests in both repositories. They must not be copied
and allowed to drift.

## Explicit non-goals for the first PaaS phase

- Replacing Xcode or pretending iOS Simulator runs locally on Windows.
- Requiring hosted PaaS for BYO-Mac development.
- Hiding or regenerating users' committed `mobile/ios` source project on every
  run.
- Creating a second PaaS-specific route or data API.
- Running the AbsoluteJS backend inside the iOS app or Mac runner.
- Shipping server secrets, signing credentials or PaaS credentials in the app.
- Supporting arbitrary interactive shell access to shared runners.
- Offering physical iPhones as part of the initial Simulator product.
- Promising App Store acceptance or bypassing store review.
- Starting with Expo and reducing the default path to React-only applications.

## Decisions required before implementation

1. Which PaaS identity/login mechanism the CLI will use and how device login is
   completed securely.
2. Initial Apple-hardware provider, region and isolation boundary.
3. Supported macOS/Xcode/Simulator image matrix and image update policy.
4. Whether private alpha includes an interactive viewer or screenshot-first
   preview.
5. Session minute, idle timeout, included quota and dedicated capacity model.
6. Source/cache/artifact retention defaults and regional/data-processing terms.
7. Transport implementation and whether to extend the existing AbsoluteJS relay
   framing or introduce a mobile-specific protocol.
8. Signing custody model and minimum permissions for TestFlight beta.
9. Compatibility retention window and who pays for retained backend producers.
10. Which managed capability follows hosted development: builds/releases,
    deployment compatibility, or sync.

Recommended ordering is hosted development, hosted build/TestFlight, deployment
compatibility, then managed sync/push. That sequence proves the remote execution
business first while steadily connecting it to the differentiated write-once
mobile platform.

## Handoff checklist

Before the PaaS team starts coding:

- Read [MOBILE_APPS_PLAN.md](./MOBILE_APPS_PLAN.md),
  [REMOTE_IOS_DEVELOPMENT.md](./REMOTE_IOS_DEVELOPMENT.md), and
  [IOS_MACOS_TESTING.md](./IOS_MACOS_TESTING.md).
- Run the BYO-Mac flow end to end and capture its protocol/log/timing output.
- Inventory the PaaS's existing identity, deployment, tunnel, artifact, secrets,
  queue, telemetry and billing services before proposing new ones.
- Produce a Phase 0 threat model and cost model.
- Agree on the shared protocol/schema ownership and compatibility policy with
  AbsoluteJS core.
- Build the smallest provider proof behind the provider-neutral interface.
- Do not modify application-facing mobile semantics merely to fit the first Mac
  vendor or runner implementation.

This document should remain a PaaS planning input. Work in AbsoluteJS can
continue independently until the PaaS team is ready to implement the shared
provider boundary.
