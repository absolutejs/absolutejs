# AbsoluteJS

Full‑stack, **type‑safe** batteries‑included platform that lets you **server‑side render _any_ modern front‑end**—React, Svelte, plain HTML, HTMX (Vue & Angular coming)—with a single Bun‑powered build step.

[![bun-required](https://img.shields.io/badge/runtime-bun%401.x-yellowgreen?logo=bun)](https://bun.sh)
[![elysia-required](https://img.shields.io/badge/server-elysia%40latest-blue?logo=elysia)](https://elysiajs.com)
![license](https://img.shields.io/badge/license-CC%20BY--NC%204.0-lightgrey)

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
import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';
import { file } from 'bun';
import { build } from 'absolutejs/core/build';
import {
	handleHTMLPageRequest,
	handleReactPageRequest,
	handleSveltePageRequest
} from 'absolutejs/core/pageHandlers';

import { ReactExample } from './react/pages/ReactExample';
import SvelteExample from './svelte/pages/SvelteExample.svelte';
import { networkingPlugin } from 'absolutejs';

const manifest = await build({
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	htmlDirectory: 'example/html',
	htmxDirectory: 'example/htmx',
	reactDirectory: 'example/react',
	svelteDirectory: 'example/svelte',
	options: { preserveIntermediateFiles: true }
});

if (!manifest) throw new Error('Manifest generation failed');

let counter = 0;

export const server = new Elysia()
	.use(staticPlugin({ assets: './example/build', prefix: '' }))

	// HTML
	.get('/', () =>
		handleHTMLPageRequest('./example/build/html/pages/HtmlExample.html')
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

---

## Plugin System

Absolute JS piggybacks on the [Elysia plugin API](https://elysiajs.com/plugins). Any Elysia plugin works out of the box; Absolute adds helpers for:

| Plugin                 | Description                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`absolute-auth`**    | Full OAuth2 flow configured with 66 providers and allows full customizability with event handlers                               |
| **`networkingPlugin`** | Starts your Elysia server with HOST/PORT defaults and adds a --host flag to toggle listening on localhost or your LAN interface |

---

## Configuration Philosophy

Everything funnels through a single `build()` call:

```ts
await build({
	reactDirectory: 'src/react',
	svelteDirectory: 'src/svelte',
	htmlDirectory: 'src/html',
	htmxDirectory: 'src/htmx',
	assetsDirectory: 'public/assets',
	options: { preserveIntermediateFiles: false }
});
```

No separate config files or environment variables—just explicit arguments with sensible defaults.

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

Creative Commons **CC BY‑NC 4.0** – see [`LICENSE`](./LICENSE) for details.
