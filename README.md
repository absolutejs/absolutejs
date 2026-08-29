# AbsoluteJS

Full‑stack, **type‑safe** batteries‑included platform that lets you **server‑side render _any_ modern front‑end**—React, Svelte, plain HTML, HTMX (Vue & Angular coming)—with a single Bun‑powered build step.

[![bun-required](https://img.shields.io/badge/runtime-bun%401.x-yellowgreen?logo=bun)](https://bun.sh)
[![elysia-required](https://img.shields.io/badge/server-elysia%40latest-blue?logo=elysia)](https://elysiajs.com)
![license](https://img.shields.io/badge/license-BSL--1.1-lightgrey)

---

## Why Absolute JS?

- **Universal SSR.** Bring your favourite UI layer; Absolute JS handles bundling, hydration, and HTML streaming.
- **One build, one manifest.** Call `build()` once—get a manifest mapping every page’s client and server assets, ready to wire into routes.
- **End‑to‑end type safety.** A unified source of truth for your types—from the database, through the server, and all the way to the client—so you can be certain of the data shape at every step.
- **Zero‑config philosophy.** Point the build at your folders; sane defaults light up everything else.
- **Plugin power.** Extend with standard Elysia plugins—ship auth, logging, i18n, and more. First‑party: `absolute-auth`, `networkingPlugin`.

---

## Requirements

| Tool       | Version | Purpose                                     |
| ---------- | ------- | ------------------------------------------- |
| **Bun**    | ≥ 1.2   | Runtime, bundler, and TypeScript transpiler |
| **Elysia** | latest  | Web server & middleware platform            |

---

## Installation

```bash
bun add @absolutejs/absolute
```

---

## Quick Start

```ts
// example/server.ts
import { staticPlugin } from '@elysia/static';
import { Elysia } from 'elysia';
import { file } from 'bun';
import { build } from 'absolutejs/core/build';
import {
	handleHTMLPageRequest,
	handleSveltePageRequest
} from 'absolutejs/core/pageHandlers';
import { handleReactPageRequest } from 'absolutejs/react';

import { ReactExample } from './react/pages/ReactExample';
import SvelteExample from './svelte/pages/SvelteExample.svelte';
import { networkingPlugin } from 'absolutejs';

const manifest = await build({
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	reactDirectory: 'example/react',
	svelteDirectory: 'example/svelte'
});

if (!manifest) throw new Error('Manifest generation failed');

let counter = 0;

export const server = new Elysia()
	.use(staticPlugin({ assets: './example/build', prefix: '' }))

	// HTML
	.get('/', () =>
		handleHTMLPageRequest('./example/build/html/pages/HTMLExample.html')
	)

	// React
	.get('/react', () =>
		handleReactPageRequest(ReactExample, manifest['ReactExampleIndex'], {
			test: 123
		})
	)

	// Svelte
	.get('/svelte', () =>
		handleSveltePageRequest(SvelteExample, manifest, { test: 456 })
	)

	// HTMX demo
	.get('/htmx', () => file('./example/build/htmx/HtmxHome.html'))
	.get('/htmx/increment', () => new Response(String(++counter)))

	.use(networkingPlugin)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});
```

### How it works

1. **`build()`** scans your project, bundles each framework, and returns a **manifest** that has the server, and client assets required to serve each route.
2. Route handlers (`handleReactPageRequest`, `handleSveltePageRequest`, …) stream HTML and inject scripts/assets based on that manifest.
3. The static plugin serves all compiled files from `/build`.

### Installable PWA and offline Sync

Enable the web-app shell once in `absolutejs.config.ts`. AbsoluteJS generates a
single shared browser bootstrap, service worker, and optional manifest, then
wires them into React, Vue, Svelte, Angular, HTML, HTMX, and island client
entries. Route and page code does not change.

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	// Existing framework directories and build settings...
	pwa: {
		manifest: {
			name: 'Acme',
			shortName: 'Acme',
			themeColor: '#111827',
			icons: [
				{
					src: '/icons/app-512.png',
					sizes: '512x512',
					type: 'image/png'
				}
			]
		},
		serviceWorker: {
			offline: {
				fallback: '/offline.html',
				assetPrefix: '/assets/'
			}
		},
		// With @absolutejs/auth + syncSocket(), this provisions the existing
		// HTTP-only web session and durable IndexedDB transport automatically.
		sync: true,
		// Optional: importing pushNotifications enables this automatically.
		// The public key defaults to VAPID_PUBLIC_KEY at build time.
		push: true
	}
});
```

The default outputs are `/sw.js`, `/manifest.webmanifest`, and the internal
shared bootstrap at `/__absolute/pwa/bootstrap.js`. Put referenced icons and the
offline fallback in `publicDirectory`. The worker uses Background Sync when the
browser offers it, while online/focus/visibility resume remains the correctness
path. Native Capacitor clients continue to use their Bearer and SQLite
transport; no web cookie or token is copied into the worker.

Portable push uses the same `pushNotifications` API in the browser and a
Capacitor shell. AbsoluteJS generates Web Push registration and subscription
rotation against the same-origin `/auth/push` route. Configure the trusted
server once with `auth({ push: { registrar, tenant, topics } })`; Auth derives
identity, tenant, and authorized topics, while page code never receives APNs,
FCM, or Web Push credentials. Only the public VAPID key enters browser output;
keep `VAPID_PRIVATE_KEY` in the server-side Dispatch sender.

`@absolutejs/pwa/client` also exposes `onPwaSyncResult()` and
`getLastPwaSyncResult()` (plus the `absolute:pwa-sync-result` DOM event) for
application-owned diagnostics. Results contain only success, duration, trigger,
and aggregate counts—never credentials, namespaces, endpoints, arguments, or
rows. Account changes are re-resolved before focus/online/visible Sync and the
old worker run is aborted and cleared before the new namespace can run.

AbsoluteJS also generates one local-storage migration bundle for web and native
from the app plus installed Sync packs. Routes stay unchanged. A package that
owns persisted data declares its JSON-safe evolution in `package.json`:

```json
{
	"absolutejs": {
		"sync": {
			"localSchema": {
				"version": 2,
				"migrations": [
					{
						"toVersion": 2,
						"operations": [
							{
								"type": "set-default",
								"collection": "tasks",
								"field": "completed",
								"value": false
							}
						]
					}
				]
			}
		}
	}
}
```

Absolute derives stable component IDs from package names, keeps independent
version ledgers, validates migration gaps during build/doctor, and applies the
same transaction atomically in IndexedDB or Capacitor SQLite before Sync starts.
The same `localSchema` object can declare `localData` rules for sensitivity,
encryption, memory-only fallback, whole-cache retention, eviction priority, and
per-principal quota. Absolute mobile stores record payloads as AES-256-GCM
ciphertext using a random key held by Keychain/Keystore; native background Sync
uses the identical authenticated format. Browsers without an audited key
provider either keep a declared fallback in memory only or fail closed. Pending
mutations are never evicted to satisfy quota.

App updates are consent-driven: `onUpdateAvailable()` latches a waiting worker
for late UI subscribers, `checkForUpdate()` performs a passive check, and
`applyUpdate()` activates and reloads only after the user accepts. AbsoluteJS
does not silently replace a running application session.

### Native device capabilities

Application code uses one provider-neutral API in web pages and Capacitor apps:

```ts
import {
	camera,
	clipboard,
	haptics,
	keyboard,
	photos,
	share,
	systemBars
} from '@absolutejs/devices';

await clipboard.writeText('Copied everywhere');
await share.share({ text: 'Shared everywhere', url: 'https://absolutejs.com' });
await haptics.impact('light');
const removeKeyboard = await keyboard.onChange(({ visible, heightPx }) => {
	document.documentElement.style.setProperty(
		'--keyboard-height',
		visible ? `${heightPx}px` : '0px'
	);
});
await systemBars.setAppearance('light', 'status');
const permission = await camera.requestPermission();
if (permission.state === 'granted') {
	const capture = await camera.takePhoto();
	image.src = capture.webPath;
}
const chosen = await photos.pick({ limit: 1 });
```

`absolute mobile init` and `absolute mobile sync` discover these named value
imports, read the tested mappings published by `@absolutejs/devices-capacitor`,
and offer to install only the exact Capacitor plugins in use. The generated
shell wires them into the shared device facade; users do not import Capacitor,
edit Swift/Kotlin, or maintain native bootstrap code. Type-only imports and test
sources do not provision plugins. `absolute mobile doctor release` rejects a
missing or mismatched plugin before release.

Run `absolute mobile inspect` from an application root for a read-only summary
of the effective mobile config, runtime package versions, discovered
capabilities/plugins, native-project state, embedded routes/frameworks, bundle
validation, and release projection. Add `--json` for a redacted CI or support
artifact; it omits credentials, device/account identifiers, absolute paths, and
detailed doctor messages. See [mobile project inspection](docs/MOBILE_INSPECT.md).

`keyboard` provides portable visibility, CSS-pixel height, dismissal, and
cleanup-safe change events. `systemBars` controls modern edge-to-edge status and
navigation bar foreground appearance/visibility through Capacitor 8 core. Its
`light` and `dark` values name the icon/text foreground. Web appearance uses
best-effort `color-scheme`; browser chrome visibility reports unsupported.

Camera capture requires an explicit `camera.requestPermission()` call from an
intentional user action. `photos.pick()` uses the item-scoped system picker
without requesting broad library access. AbsoluteJS generates the required iOS
usage descriptions from the same audited capability metadata; this first slice
does not expose EXIF metadata or save captures into the gallery, and Android does
not receive unnecessary camera/storage permissions.

Clipboard and Share use browser standards on the web and fail with normalized
errors when unavailable. Haptics uses vibration where supported and otherwise
safely becomes a no-op, because tactile feedback must never be required to
complete an action.

### Immutable production images

Build production assets and the server bundle while constructing the image,
then launch that prepared output without writing to it at runtime:

```bash
absolute prepare src/server.ts --outdir build
absolute start src/server.ts --outdir build --prebuilt
```

If image optimization is enabled in a read-only container, configure its
runtime cache on a bounded writable filesystem such as a `tmpfs`:

```ts
export default defineConfig({
	buildDirectory: 'build',
	images: { cacheDirectory: '/tmp/absolutejs-image-cache' }
});
```

---

## Plugin System

Absolute JS piggybacks on the [Elysia plugin API](https://elysiajs.com/plugins). Any Elysia plugin works out of the box; Absolute adds helpers for:

| Plugin                 | Description                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| **`absolute-auth`**    | Full OAuth2 flow configured with 66 providers and allows full customizability with event handlers |
| **`networkingPlugin`** | Starts your Elysia server with HOST/PORT defaults from environment variables                      |

### Elysia composition contract

This contract is written for application authors and coding agents. It avoids
the runaway TypeScript instantiation cost that can occur when one inferred
Elysia application is repeatedly extended and re-aliased.

- Start every independently owned route surface from a named `new Elysia(...)`.
- Give each surface its shared context and plugins explicitly. Do not create
  `adminApp` by extending `publicApp`, for example.
- Prefer one shallow `.use([auth, metrics])` over a long sequence of `.use()`
  calls. `absolute/elysia-composition-boundaries` enforces this and safely
  auto-fixes comment-free chains.
- Mount independent route surfaces at the platform root. Export each real
  sub-application type for Eden consumers instead of exporting an accumulated
  server alias.
- Keep `elysia` and `@sinclair/typebox` on one physical installed identity
  across the workspace. Run `absolute doctor`; `absolute doctor --fix` aligns
  root overrides and rebuilds Bun's dependency graph when peer contexts drift.

After a dependency change, measure a cold typecheck once. Warm incremental
checks can hide an unhealthy graph:

```bash
/usr/bin/time -v bun run tsc --noEmit --incremental false
```

---

## Configuration Philosophy

Everything funnels through a single `build()` call:

```ts
await build({
	reactDirectory: 'src/react',
	svelteDirectory: 'src/svelte',
	htmlDirectory: 'src/html',
	htmxDirectory: 'src/htmx',
	assetsDirectory: 'public/assets'
});
```

No separate config files or environment variables—just explicit arguments with sensible defaults.

## Workspace Dev Logs

`absolute workspace dev` keeps the TUI focused on service status and live service output. Full logs are also written to `.absolutejs/workspace/logs/`, including `all.log` and one file per service, so long output can be copied or searched outside the TUI:

```bash
tail -n 200 .absolutejs/workspace/logs/all.log
```

---

## Roadmap

- **Angular** handlers
- Prisma support
- Biome support
- Hot‑reload development server
- First‑class Docker images & hosting recipes

---

## Contributing

Pull requests and issues are welcome! Whether it’s a new plugin, framework handler, or docs improvement:

1. Fork & branch.
2. `bun install && bun test`.
3. Submit a PR with a clear description.

---

## License

**Business Source License 1.1 (BSL-1.1)** – see [`LICENSE`](./LICENSE) for details.
