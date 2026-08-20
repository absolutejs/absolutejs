# AbsoluteJS ecosystem migration to Elysia 2

Status: implementation in progress; Wave 1 source migrations complete, coordinated release pending

Research snapshot: August 19, 2026

Target baseline: `elysia@2.0.0-beta.6`

## Decision

AbsoluteJS and the maintained `@absolutejs/*` ecosystem will move to Elysia 2
now. Elysia 1.4 is not a second runtime target for the new AbsoluteJS line.

During the beta, framework and official-plugin development dependencies must be
locked to exact tested versions. Published peer ranges may begin at the tested
beta and extend through Elysia 2, but a release is allowed only after CI has
tested the exact dependency set recorded in that release. Updating an Elysia beta
is a deliberate ecosystem change, not a routine floating lockfile refresh.

Initial tested versions:

| Package | Baseline |
| --- | --- |
| `elysia` | `2.0.0-beta.6` |
| `@elysia/static` | `2.0.0-beta.2` |
| `@elysia/openapi` | `2.0.0-beta.1` |
| `@elysia/server-timing` | `2.0.0-beta.1` |
| `@elysia/opentelemetry` | `2.0.0-beta.1` |
| `typebox` | `1.3.16` |
| `exact-mirror` | `1.2.4` |
| TypeScript | `5.9.3` (already satisfies Elysia 2's `>=5.7` requirement) |

The old `@elysiajs/*` package scope is for Elysia 1.x. Maintained integrations
move to `@elysia/*`. Swagger scaffolds move to `@elysia/openapi`; there is no
Elysia 2 `@elysia/swagger` package.

## Why this is an ecosystem migration

AbsoluteJS is not the only Elysia consumer in `~/abs`. Direct reusable consumers
include Auth, Sync, Queue, Errors, Health, Metrics, Rate Limit, Observability,
Metering, RAG, AI, Voice, Scoped State, MCP, Blog, and the Elysia audit adapter.
Applications, documentation, templates, examples, benchmarks, PAAS, and Renown
also contain Elysia code.

Several packages currently exclude Elysia 2 in their peer range. Others use broad
old ranges that would incorrectly claim compatibility without having migrated.
A root-only dependency bump would therefore create multiple Elysia copies, broken
plugin types, or plugins that register old lifecycle APIs.

## What the official codemod can and cannot do

The official command is:

```bash
bunx @elysia/codemod@latest --check --to 2
```

Use `--check` as an inventory and review tool. Apply changes only to a narrowly
selected set of Elysia source files, inspect the resulting diff, and then express
the accepted changes as normal reviewed edits. Never apply it wholesale to an
AbsoluteJS or `~/abs` repository.

The codemod reliably identifies or rewrites many mechanical changes:

- three-argument route calls become `(path, hooks, handler)`;
- lifecycle registration drops the `on` prefix, with `onStart`/`onStop` becoming
  `setup`/`cleanup`;
- `.resolve()` and `resolve` hook fields become `derive`;
- scoped hooks use `plugin`, and scope arguments move to their new positions;
- additive guard schemas explicitly use `schema: 'merge'`;
- `t.Transform` becomes `t.Codec`;
- macros use the object form;
- `NotFoundError` becomes `NotFound`;
- WebSocket and trace capabilities become explicit plugins;
- official plugin imports move from `@elysiajs/*` to `@elysia/*`.

It intentionally leaves semantic warnings for error dispatch, redirect helpers,
response hook fields, parser content type, mounted instances, named handlers,
scoped guard callbacks, removed methods, WebSocket behavior, removed TypeBox
constructors, and file MIME detection.

It also has material limitations in this workspace:

- rules operate on `.ts`, not `.tsx`;
- receiver matching is syntactic rather than type-aware;
- it reported real false positives on Promise `.resolve()`, storage `.put()`, Vue
  `.mount()`, Angular/Vue `onError` methods, and non-Elysia HTTP clients;
- it may collapse formatting in method chains;
- its dependency finalizer currently selects an experimental Elysia tag rather
  than the chosen beta baseline.

For those reasons, the codemod is evidence, not the migration authority.

## Elysia 2 contract changes that matter here

### Route and lifecycle behavior

- Three-argument route hooks precede the handler.
- Registration APIs are `request`, `parse`, `transform`, `beforeHandle`,
  `afterHandle`, `mapResponse`, `afterResponse`, `error`, `setup`, and `cleanup`.
- `afterHandle` short-circuits remaining `afterHandle` hooks when one returns.
- A bodyless GET or HEAD request does not run body parsing.
- Early values returned from request hooks pass through `mapResponse`.
- `context.path` is read-only.
- `parse` receives content type on `context.contentType`, not as a second argument.
- Response hooks use `responseValue` for the current value.

### Errors

`error.code` is removed. Error mappings are class based, and general handlers
must use error types or `instanceof`. AbsoluteJS's not-found fallback and every
package with code-based branching require manual review. Elysia 2 can emit RFC
9457 problem responses, but adopting that wire format is a separate public API
decision; migration must not silently change AbsoluteJS client error contracts.

### Scope and schemas

Guards and groups default to schema override. Elysia 1's additive behavior must
be preserved with `schema: 'merge'` where intended. Scope name `scoped` becomes
`plugin`.

The Elysia 2 launch post contains older wording that calls the additive mode
`standalone`. The published beta.6 type declarations and current official
codemod both use `merge` and explicitly migrate `standalone` to `merge`; those
versioned artifacts govern this migration. A small executable conformance probe
must remain in CI until Elysia 2 is stable.

### TypeBox boundary

Elysia 2 moved from `@sinclair/typebox` 0.34 to the `typebox` 1.x package and can
also consume Standard Schema validators. Any schema passed to an Elysia route,
model, guard, macro, or response validator must come from Elysia 2's `t`, its
compatible TypeBox line, or a verified Standard Schema implementation.

Independent internal uses of `@sinclair/typebox` do not all need to migrate on
day one. For example, an environment-file validator that never crosses the
Elysia boundary may stay on 0.34 temporarily. It must not export an old schema
that a consumer can pass into Elysia 2. AbsoluteJS's type-graph coherence check
must track `elysia`, `typebox`, and `exact-mirror`, while treating legacy
`@sinclair/typebox` as an explicitly separate graph until removed.

TypeBox 1 migration needs manual review for removed or changed APIs including
`Recursive`, `Not`, `RegExp`, transforms/codecs, and `NoValidate` behavior.

### WebSockets

WebSockets are now an explicit capability:

```ts
import { websocket } from 'elysia/websocket';

new Elysia().use(websocket({
  idleTimeout: 120,
  sendPings: true
}));
```

AbsoluteJS cannot treat this as an import rename. Its networking plugin currently
mutates removed public config getters, reads the removed public store getter, and
manually installs Elysia's low-level WebSocket dispatcher into Bun server reloads.
The compiled runtime does the same. Elysia 2's Bun adapter resolves the capability,
combines its options, builds the dispatcher, and attaches lifecycle tracking at
listen time.

The migration must provide an Absolute-owned server handoff primitive that obtains
the finalized Bun serve configuration through supported Elysia 2 adapter behavior.
Depending directly on private `~config` or `~ext` fields is prohibited. HMR must
still preserve declared state, existing sockets, static-route invalidation, and
post-reload WebSocket upgrades. Compiled binaries must use the same handoff rather
than importing a low-level global dispatcher independently.

### AOT and adapters

Dynamic mode and `aot: false` are gone. Elysia 2 exposes Adapter v2 and official
AOT build plugins. AbsoluteJS should integrate the Bun AOT plugin into its server
build and consume Elysia's finalized route capture for mobile route discovery.
AbsoluteJS still owns page identity, framework asset identity, component-prop
contracts, and release compatibility metadata; those are not Elysia manifest
fields.

The configured server entry must export the Elysia application for AOT capture.
Mounted fetch handlers and opaque sub-apps need an explicit diagnostic because
the current AOT capture cannot flatten every mount form.

### Other manual checks

- `t.File({ type })` requires an explicit file type detector.
- Signed cookie verification defaults to lazy verification.
- Validation response bodies, codec order, shared `Response` mutation, streamed
  byte handling, and WebSocket query parsing changed.
- Removed instance getters and deprecated helpers must not be replaced with
  Elysia private fields.

## AbsoluteJS-specific work

1. Replace lifecycle registrations and route argument order in Elysia-owned files.
2. Replace code-based not-found handling in `prepare()` with class-based mapping.
3. Move official plugins to `@elysia/*` beta packages and update integration
   catalog, CLI copy, doctor output, templates, and documentation.
4. Register the WebSocket capability once with AbsoluteJS keepalive defaults.
5. Redesign networking HMR and the compiled-runtime server bootstrap around the
   supported Elysia 2 Bun adapter/provider contract.
6. Update the dev route-registration callsite patch for v2 argument order.
7. Update type-graph coherence for `typebox` 1 and enforce the old-schema boundary.
8. Add Elysia AOT to the server build and join its finalized route graph to
   AbsoluteJS page metadata.
9. Update generated projects, fixtures, examples, and compile-runtime source.
10. Add conformance coverage for HTTP lifecycle order, errors, guards, cookies,
    files, streaming, WebSockets, HMR, compiled binaries, AOT, OpenAPI, and Eden.

## Ordered ecosystem rollout

This is a coordinated source migration, but it should land in dependency order so
each failure has a small blast radius.

### Wave 0: lock the contract

- Pin beta versions and record the tested matrix.
- Add reusable Elysia 2 conformance fixtures and a codemod-check report format.
- Define the Elysia schema boundary and package peer-range policy.
- Build the networking/AOT spike before changing the AbsoluteJS default.

Exit gate: a minimal Elysia 2 app proves HTTP, a guarded route, mapped errors,
WebSocket connect/reload, AOT capture, and compiled server startup using the
intended AbsoluteJS primitives.

### Wave 1: leaf plugins

Migrate Errors first, then Health, Metrics, Rate Limit, Queue, Metering, Blog,
Scoped State, MCP, and the Elysia audit adapter. Observability follows Errors
because it consumes that package.

Exit gate per package: exact-beta install, typecheck, package-specific validation,
clean peer graph, and a consumer fixture proving plugin composition.

Current implementation snapshot (August 19, 2026): the Wave 1 source migrations
are complete for Scoped State, Errors, Health, Metrics, Rate Limit, Queue,
Metering, Blog, MCP, the Elysia audit adapter, and Observability. Each package has
been moved to its next pre-1.0 minor version; no package was promoted to 1.0.
Package typechecks, tests, and builds pass against the selected Elysia beta. MCP
also has an executable Elysia 2 host-composition test, and the audit adapter's
global lifecycle behavior was verified against the beta runtime.
`create-absolutejs@0.16.0` has also been staged so newly generated projects use
the coordinated AbsoluteJS versions and the Elysia 2 `@elysia/*` package scope.

The Wave 1 packages are not published by this migration work. Their release must
be coordinated with `@absolutejs/manifest@0.9.0`, whose public validator now uses
standard `peerDependencies` and `peerDependenciesMeta` rather than custom runtime
peer or build-artifact metadata. Publish Manifest first, then Errors before
Observability, then the remaining leaves, and finally the AbsoluteJS runtime.
Until Manifest 0.9 exists in the registry, consumer lockfiles that declare 0.9
cannot be truthfully refreshed from npm; refresh and validate those lockfiles as
part of the publication staging step rather than fabricating resolutions.

### Wave 2: stateful and realtime packages

Migrate Sync, then AI, then RAG and Voice. Auth can proceed alongside Sync after
the error/schema fixtures exist. These packages need protocol-level checks for
cookies/tokens, WebSocket behavior, reconnects, streaming, and validation—not
only compilation.

Exit gate: current web behavior and the mobile data/auth/sync contracts pass
against one Elysia 2 server without duplicated Elysia or TypeBox instances.

### Wave 3: AbsoluteJS runtime

Land the lifecycle/error/plugin changes, WebSocket server handoff, HMR state
bridge, compiled-runtime bootstrap, AOT integration, route capture, type-graph
coherence, and updated project generator together. Do not publish a runtime that
claims Elysia 2 while either dev HMR or compiled WebSockets still uses the v1
dispatcher path.

Exit gate: all supported page frameworks pass HTTP production, dev reload, and
compiled-runtime conformance; WebSocket packages pass before/after backend HMR;
mobile route capture receives the finalized v2 graph.

### Wave 4: consumers

Migrate PAAS, Renown, docs applications, templates, examples, and benchmarks.
Codemod results here require especially strict review because API clients and UI
components account for many false-positive verb and lifecycle matches.

Exit gate: repository-wide searches find no maintained Elysia 1 package scopes,
old lifecycle registrations, incompatible peer ranges, or old Elysia route schemas.

## Validation policy

Every migrated repository must run its allowed typecheck and lint commands plus
focused Elysia 2 conformance checks. The full ecosystem release pipeline must also
run tests, package builds, packed-artifact consumer installs, and duplicate-package
checks in CI. A local repository instruction that forbids a command remains in
force; migration completion is not inferred from typecheck alone.

Required behavioral scenarios:

- hook order and short circuiting;
- guard merge/override behavior;
- mapped built-in and custom errors;
- cookie signing and lazy verification;
- Standard Schema and TypeBox 1 request/response validation;
- file validation with the selected detector;
- streamed and deferred responses;
- WebSocket schema, query, lifecycle, and reconnect behavior;
- backend HMR with state and live sockets;
- compiled-server WebSocket upgrades;
- OpenAPI schema output and CLI API inspection;
- AOT capture of prefixed, grouped, guarded, macro-generated, and plugin routes;
- Eden clients where maintained packages expose them;
- AbsoluteJS mobile route and page-contract capture.

## Beta update procedure

For each new Elysia 2 beta:

1. Read the official release diff, migration guide, package exports, and plugin
   releases.
2. Pack and inspect the exact artifacts; do not rely only on a moving web page.
3. Re-run the codemod in check mode and compare warning/rule changes.
4. Run the contract probes and full cross-package conformance matrix.
5. Update all exact tested versions in one reviewed change.
6. Publish only after packed consumers resolve one Elysia and one Elysia-facing
   TypeBox graph.

## Primary references

- [Elysia 2 beta announcement and breaking changes](https://elysiajs.com/blog/elysia-20)
- [Official Elysia repository](https://github.com/elysiajs/elysia)
- [Official Elysia 2 migration guide discussion](https://github.com/elysiajs/elysia/pull/1873#issuecomment-4734573873)
- [Official TypeBox 1 migration guide](https://github.com/sinclairzx81/typebox/blob/main/changelog/1.0.0-migration.md)
- [Elysia npm package](https://www.npmjs.com/package/elysia)
