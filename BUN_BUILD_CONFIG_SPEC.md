# Spec: Expose Guarded Bun Build Options

## Why

Absolute presets Bun build options at each `bunBuild()` call site in
`src/core/build.ts`, and users currently cannot override those settings.
The issue surfaced through a `minify` use case, but the framework problem
is broader: any Bun build option that Absolute hardcodes today can become
the next option a project needs to tune.

Adding only a top-level `minify` field would solve one symptom while
leaving the same escape-hatch problem for the next Bun build option.

This change should expose a guarded subset of Bun's own `BuildConfig`,
with defaults that preserve Absolute's current behavior and per-pass
overrides for the different `bunBuild()` calls.

## Current Build Passes

`src/core/build.ts` currently builds six independent Bun passes in the
production build flow:

| Pass key         | Trace label            | Current purpose                                                                       | Current notable fixed fields                                                |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `server`         | `bun/server`           | Compiled Svelte/Vue/Angular server modules                                            | `target: 'bun'`, `format: 'esm'`, framework externals                       |
| `reactClient`    | `bun/react-client`     | React page/index client entries                                                       | `target: 'browser'`, `format: 'esm'`, `minify: !isDev`, `splitting: true`   |
| `nonReactClient` | `bun/non-react-client` | Svelte/Vue/Angular/HTML/HTMX client entries, island bootstrap, URL-referenced workers | `target: 'browser'`, `format: 'esm'`, `minify: !isDev`, `splitting: !isDev` |
| `islandClient`   | `bun/island-client`    | Generated island client entry points                                                  | `target: 'browser'`, `format: 'esm'`, `minify: !isDev`, `splitting: !isDev` |
| `globalCss`      | `bun/global-css`       | Global CSS entry points                                                               | `target: 'browser'`                                                         |
| `vueCss`         | `bun/vue-css`          | CSS emitted by Vue compilation                                                        | `target: 'browser'`                                                         |

Only the three client JS passes currently set `minify`, but the
user-facing API should cover all six passes because users may need
different Bun settings for each pass.

Out of initial scope:

- Vendor/HMR builds in `src/build/*` and `src/dev/*`, which are internal
  development support bundles and intentionally use their own settings.
- `compileTailwind` in `src/build/compileTailwind.ts`, which uses
  `bun-plugin-tailwind` as an implementation detail of the Tailwind
  integration rather than one of the app output passes in `src/core/build.ts`.

## User-Facing API

Add a new top-level `bunBuild` field to `BaseBuildConfig`.

It should accept either:

1. A single guarded Bun config object applied to every eligible pass.
2. An object with a `default` config plus per-pass overrides.

Absolute config supports two valid shapes, and this option must work in
both:

- Single-service config: service fields live at the root of
  `absolute.config.ts`.
- Multi-service workspace config: each named Absolute service gets its own
  service object, while command services do not use `bunBuild`.

Single-service example:

```ts
export default defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		default: {
			sourcemap: 'linked'
		},
		reactClient: {
			minify: {
				whitespace: true,
				syntax: true,
				identifiers: false
			}
		},
		nonReactClient: {
			minify: false
		}
	}
});
```

Multi-service example:

```ts
export default defineConfig({
	app: {
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react',
		bunBuild: {
			default: {
				sourcemap: 'linked'
			},
			reactClient: {
				minify: {
					whitespace: true,
					syntax: true,
					identifiers: false
				}
			},
			nonReactClient: {
				minify: false
			}
		}
	}
});
```

For simple cases, this should also work:

```ts
export default defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		minify: {
			whitespace: true,
			syntax: true,
			identifiers: false
		}
	}
});
```

In the shorthand form above, the config is used as the default override
for all six passes. Users who need different behavior between server,
client, island, or CSS output should use the per-pass object form.

## Type Design

Use Bun's own public type, not an Absolute redefinition of Bun options.
The local `BuildConfig` name is already used for Absolute's service config,
so import Bun's type with an alias.

```ts
import type { BuildConfig as BunBuildConfig } from 'bun';
```

Then derive an override type from Bun's keys while excluding fields that
Absolute must own.

```ts
type ReservedBunBuildConfigKey =
	| 'entrypoints'
	| 'outdir'
	| 'outfile'
	| 'root'
	| 'target'
	| 'format'
	| 'throw'
	| 'compile';

export type BunBuildConfigOverride = Partial<
	Pick<
		BunBuildConfig,
		Exclude<keyof BunBuildConfig, ReservedBunBuildConfigKey>
	>
>;

export type BunBuildPassConfig = {
	default?: BunBuildConfigOverride;
	server?: BunBuildConfigOverride;
	reactClient?: BunBuildConfigOverride;
	nonReactClient?: BunBuildConfigOverride;
	islandClient?: BunBuildConfigOverride;
	globalCss?: BunBuildConfigOverride;
	vueCss?: BunBuildConfigOverride;
};
```

Then add this to `BaseBuildConfig`:

```ts
bunBuild?: BunBuildConfigOverride | BunBuildPassConfig;
```

### Reserved Fields

The initial reserved list should block fields that would break Absolute's
routing, output manifest, runtime target assumptions, or error handling:

| Field                | Reason                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `entrypoints`        | Absolute computes framework/page/island entries from conventions and incremental rebuild state.    |
| `outdir` / `outfile` | Absolute owns output layout and manifest path resolution.                                          |
| `root`               | Absolute uses roots to preserve framework-relative output paths.                                   |
| `target`             | Absolute requires `browser` for client/CSS passes and `bun` for server passes.                     |
| `format`             | Absolute expects ESM output for import/manifest/runtime behavior.                                  |
| `throw`              | Absolute handles failed builds through `extractBuildError`, telemetry, and `options.throwOnError`. |
| `compile`            | Standalone executable builds are incompatible with these multi-output app bundle passes.           |

Fields that need special care but should remain available if possible:

| Field       | Handling                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `plugins`   | Merge with Absolute's internal plugins instead of replacing them. Internal plugins should run first, user plugins after. |
| `external`  | Merge and de-duplicate with Absolute's framework/vendor externals.                                                       |
| `define`    | Merge with Absolute's required framework defines, with Absolute-owned keys winning for Vue feature flags.                |
| `naming`    | Allow override, but tests must confirm manifest generation and URL rewriting still work.                                 |
| `splitting` | Allow override. This is user-facing Bun behavior, unlike `target`, but tests must cover manifest output shape.           |
| `tsconfig`  | Allow override unless implementation discovers a hard requirement for `./tsconfig.json`.                                 |

If TypeScript does not distribute `Pick` cleanly across Bun's union type,
use a small distributive helper:

```ts
type DistributivePartialOmit<T, K extends PropertyKey> = T extends unknown
	? Partial<Omit<T, Extract<keyof T, K>>>
	: never;

export type BunBuildConfigOverride = DistributivePartialOmit<
	BunBuildConfig,
	ReservedBunBuildConfigKey
>;
```

## Merge Semantics

Resolve the effective override for a pass as:

1. Absolute's existing pass defaults.
2. `bunBuild` single-object config, or `bunBuild.default`.
3. `bunBuild[passKey]`.
4. Absolute-owned required values that must win after merging, if the
   field is merged rather than reserved.

For reserved fields, prefer a type-level block. Runtime code should also
avoid blindly spreading user config after internal config in a way that
lets reserved fields slip through from `as any` user code.

Recommended helper shape:

```ts
const resolveBunBuildOverride = (
	config: BuildConfig['bunBuild'],
	pass: BunBuildPassKey
) => {
	if (!config) return {};
	if (isDirectBunBuildOverride(config)) return config;

	return {
		...(config.default ?? {}),
		...(config[pass] ?? {})
	};
};
```

Each pass should use a merge helper rather than inline spreads so array and
object fields are handled consistently:

```ts
const mergeBunBuildConfig = (
	base: Parameters<typeof bunBuild>[0],
	override: BunBuildConfigOverride,
	required: Partial<Parameters<typeof bunBuild>[0]> = {}
): Parameters<typeof bunBuild>[0] => {
	const merged = {
		...base,
		...override,
		...required
	};

	return {
		...merged,
		define: {
			...(override.define ?? {}),
			...(base.define ?? {}),
			...(required.define ?? {})
		},
		external: dedupe([
			...(base.external ?? []),
			...(override.external ?? []),
			...(required.external ?? [])
		]),
		plugins: [
			...(base.plugins ?? []),
			...(override.plugins ?? []),
			...(required.plugins ?? [])
		]
	};
};
```

Exact helper implementation can differ, but the important rule is:
internal required behavior cannot be accidentally removed by a user
override, while normal Bun options can be changed.

## Files To Touch

| File                | Change                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `types/build.ts`    | Import Bun's `BuildConfig` as `BunBuildConfig`; add derived guarded override types; add `bunBuild?` to `BaseBuildConfig`. |
| `src/core/build.ts` | Destructure `bunBuild`; resolve per-pass overrides; merge overrides into all six `bunBuild()` configs.                    |
| Tests               | Add focused type/runtime tests for direct config, `default`, pass-specific overrides, and reserved-field protection.      |

## Behavioral Requirements

- Existing projects with no `bunBuild` config keep current output behavior.
- Users can set any allowed Bun build option globally or per pass.
- Users can configure other Bun build options from Bun's own type, such as
  `minify`, `sourcemap`, `drop`, `ignoreDCEAnnotations`, `loader`,
  `conditions`, `env`, `banner`, `footer`, and `metafile`.
- Users cannot change `target`; TypeScript should reject it in
  `absolute.config.ts`.
- Per-pass values override `default` values.
- Internal plugins required for CSS preprocessing, Angular linking, and
  HTML/HTMX HMR injection still run.
- Internal externals required for framework server builds and dev vendor
  behavior still apply.

## Test Cases

### Type/API Tests

1. `bunBuild: { target: 'node' }` fails because `target` is reserved.
2. Reserved fields also fail under pass-specific config, e.g.
   `bunBuild: { reactClient: { outdir: 'custom' } }`.
3. `bunBuild: { reactClient: { minify: { identifiers: false } } }`
   accepts Bun's granular `minify` object from Bun's type.
4. Both config shapes type-check:
    - single-service root config with `bunBuild` at the root
    - multi-service config with `bunBuild` inside a named Absolute service

### Override Resolution Tests

1. No `bunBuild` field preserves the current default production
   `minify: true` and dev `minify: false` behavior for client JS passes.
2. `bunBuild.default.sourcemap = 'linked'` reaches all six build passes.
3. `bunBuild.reactClient.minify = false` overrides only the React client
   pass when per-pass form is used.
4. A single-object shorthand, such as `bunBuild: { sourcemap: 'linked' }`,
   behaves like a default override for all six passes.

### Special-Care Field Tests

1. `plugins`: user plugins are appended after Absolute's internal plugins,
   and CSS preprocessing, Angular linker behavior, and HTML/HTMX HMR script
   injection still work.
2. `external`: user externals merge with Absolute's framework/vendor
   externals. The test should assert de-duplication and confirm server
   framework externals such as `react`, `svelte`, `vue`, `@angular/*`, and
   `typescript` are not lost.
3. `define`: user defines merge with Absolute's defines. For Vue builds,
   Absolute-owned Vue feature flags must still win if the user provides the
   same keys.
4. `naming` string override: build with an unusual but valid string pattern
   such as `assets/[name]-custom.[ext]` and confirm `manifest.json`,
   `updateAssetPaths`, and client asset URLs still point at emitted files.
5. `naming` object override: build with `{ entry, chunk, asset }` patterns
   that include subdirectories and omit `[hash]`; confirm manifest keys are
   stable, duplicate-key warnings still behave as expected, and generated
   HTML/HTMX pages reference the emitted paths.
6. `naming` collision case: intentionally configure a risky pattern such as
   `[name].[ext]` across multiple frameworks with matching page names. The
   expected behavior should be explicit before implementation: either reject
   unsafe naming at runtime or allow Bun's output and assert Absolute emits
   the existing duplicate manifest warning.
7. `naming` and URL-referenced files: with a worker or other file referenced
   by `new URL('./worker.ts', import.meta.url)`, override non-React client
   naming and confirm `rewriteUrlReferences` still rewrites to the emitted
   file path.
8. `splitting`: set `splitting: false` for `nonReactClient` and
   `islandClient`; confirm manifest generation, island client entries, and
   HTML asset rewriting still work with fewer/no chunks.
9. `splitting`: set `splitting: true` in development/default override and
   confirm dev/HMR builds either work or the implementation documents and
   guards against unsupported combinations.
10. `tsconfig`: point a pass at a custom tsconfig that defines an import path
    alias, build an entry that uses that alias, and confirm the alias resolves
    without breaking Absolute's default `./tsconfig.json` behavior when the
    override is omitted.
