# Refactor: Move Intermediate Build Files Out of Source Directories

## Problem

The build pipeline generates intermediate files inside framework source directories:

- `react/indexes/` — generated hydration entry points (`.tsx`)
- `svelte/server/` and `svelte/client/` — compiled SSR and client variants
- `vue/server/` and `vue/client/` — compiled SSR and client variants
- `angular/compiled/` — Angular compiler output

This causes:
1. Source directories polluted with build artifacts
2. File watcher picks up generated files, causing cascading rebuilds
3. `rmSync` on `react/indexes/` during rebuilds causes ENOENT when another rebuild runs concurrently
4. Users must create `react/indexes/` directory manually
5. `shouldSkipFilename` has a growing list of intermediate dirs to exclude
6. Git ignore complexity — users need to ignore these dirs

## Solution

Move all intermediate files to `.absolutejs/` — the existing framework-managed directory.

`.absolutejs/` already contains build caches (angular-linker, eslint, prettier, tsconfig),
HTTPS dev certs, and is already gitignored. Intermediate build files are the same category —
framework-managed artifacts that users shouldn't touch.

```
.absolutejs/
  cache/angular-linker/ ← already exists
  cert.pem / key.pem    ← already exists
  eslint-cache           ← already exists
  prettier.cache.json    ← already exists
  tsconfig.tsbuildinfo   ← already exists
  generated/
    react-indexes/       ← hydration entry points
    svelte-server/       ← Svelte SSR output
    svelte-client/       ← Svelte client output
    vue-server/          ← Vue SSR output
    vue-client/          ← Vue client output
    angular/             ← Angular compiler output
```

`build/` stays clean — only final deployable output.

## Files to Change

### Core Build (`src/core/build.ts`)
- `reactIndexesPath`: change from `join(reactDir, 'indexes')` to `join('.absolutejs', 'generated', 'react-indexes')`
- `serverDirMap`: change `{ dir: svelteDir, subdir: 'server' }` to use `join('.absolutejs', 'generated', 'svelte-server')`
- Vue: `join('.absolutejs', 'generated', 'vue-server')` and `vue-client`
- Angular: `join('.absolutejs', 'generated', 'angular')`
- Remove `rmSync` on `react/indexes` and `angular/indexes` — `.absolutejs/generated/` can be cleaned wholesale
- Update `clientRoot` computation — compiled paths are now outside source tree
- Update entry point scanning to look in `.absolutejs/generated/` for compiled outputs

### React Index Generation (`src/build/generateReactIndexes.ts`)
- Change output directory from `react/indexes/` to `.absolutejs/generated/react-indexes/`

### Svelte Compilation (`src/build/compileSvelte.ts`)
- Change output directories from `svelte/server/` and `svelte/client/` to `.absolutejs/generated/svelte-server/` and `svelte-client/`

### Vue Compilation (`src/build/compileVue.ts`)
- Change output directories from `vue/server/` and `vue/client/` to `.absolutejs/generated/vue-server/` and `vue-client/`

### Angular Compilation (`src/build/compileAngular.ts`)
- Change output directory from `angular/compiled/` to `.absolutejs/generated/angular/`

### Manifest Generator (`src/build/generateManifest.ts`)
- Update framework detection — currently checks for `react`/`svelte`/`vue`/`angular` in path segments
- May need adjustment since intermediate paths have different structure

### File Watcher (`src/dev/pathUtils.ts`)
- Remove `server`, `client`, `compiled`, `indexes` from `shouldSkipFilename` (they no longer exist in source)
- Remove from `SKIP_DIRS` in `build.ts` scanner
- `.absolutejs/` is already excluded from watching

### Module Server (`src/dev/moduleServer.ts`)
- Update any path resolution that looks for compiled files in framework dirs

### HMR Handlers (`src/dev/rebuildTrigger.ts`)
- Update paths that reference `compiled/`, `server/`, `client/`, `indexes/` within framework dirs
- Angular fast path uses `resolve(angularDir, 'compiled')` — needs update

### Cleanup (`src/utils/cleanup.ts`)
- Add `rm -rf .absolutejs/generated/` to cleanup routine
- Or clean on full rebuild only (incremental rebuilds just overwrite)

### Remove `preserveIntermediateFiles` flag
- Currently in `BuildConfig` and checked in `build.ts` to skip cleanup of `compiled/` dirs
- No longer needed — generated files live in `.absolutejs/generated/` which is always kept
- Remove from `types/build.ts`, `src/core/build.ts`, and any config references

### DevBuild (`src/core/devBuild.ts`)
- Update pre-warm cache paths
- Update any intermediate dir references

## Migration

- No user-facing config changes needed — config still points to `reactDirectory: './src/frontend/react'` etc.
- `.absolutejs/` is already gitignored
- Existing `react/indexes/`, `svelte/server/`, `svelte/client/`, `vue/server/`, `vue/client/`, `angular/compiled/` in user source dirs become stale and can be deleted
- Add a note in the changelog to delete these directories after updating

## Benefits

- Clean source directories — no generated files mixed with user code
- No more ENOENT from concurrent `rmSync` — intermediates are outside the source tree
- File watcher is simpler — no need to skip intermediate dirs in source
- No new managed location — `.absolutejs/` already exists and is already gitignored
- Users don't need to create `react/indexes/` manually
- `build/` stays clean and deployable
