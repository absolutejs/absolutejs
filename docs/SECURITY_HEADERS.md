# Security headers and CSP nonces

`secureHeaders()` adds a strict Content-Security-Policy with a per-request
nonce, plus the usual security headers. It's opt-in. Register it before
`absolutejs`:

```ts
import { prepare, secureHeaders } from '@absolutejs/absolute';

const { absolutejs, manifest } = await prepare();

export const server = new Elysia()
	.use(secureHeaders())
	.use(absolutejs)
	.get('/', () => handleReactPageRequest({ … }));
```

## What it sends

| Header | Default |
| --- | --- |
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(), payment=(), usb=()` |

The default policy:

```
base-uri 'self'; connect-src 'self'; default-src 'self'; font-src 'self' data:;
form-action 'self'; img-src 'self' data: blob:; manifest-src 'self'; object-src 'none';
script-src 'self' 'strict-dynamic' 'nonce-…'; style-src 'self' 'nonce-…';
style-src-attr 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'self'
```

- **Scripts** run only with the request's nonce. There's no `'unsafe-inline'`.
  `'strict-dynamic'` lets a script that has the nonce load others, so
  hydration chunks, islands and lazy routes work without listing them.
- **Inline styles** need the nonce too. `style=""` attributes are allowed:
  frameworks write them (Vue `:style`, Svelte `style:`), and they can't run
  script.
- **In development** the policy also allows the HMR WebSocket
  (`ws://host`, `wss://host`) and `'unsafe-eval'`, which Angular's dev
  compiler needs. Production doesn't get either.

## What carries the nonce

Each request gets a new 128-bit random nonce. AbsoluteJS puts it on every
inline `<script>` and `<style>` it writes:

- page bootstraps and initial props, for React, Svelte, Vue, Angular and
  Ember;
- island state and the island bootstrap;
- streaming-slot runtime and patches;
- inline page CSS, and the styles Svelte and Angular render;
- speculation rules;
- the dev HMR client, and the error pages.

htmx is configured to put the nonce on its indicator styles. Static HTML and
HTMX pages are your own files, so every inline script and style in them gets
the nonce.

On framework pages (React, Svelte, Vue, Angular) the nonce is added where
each script is written, not by rewriting the finished HTML. That's
deliberate: a script injected through `{@html}`, `v-html` or
`dangerouslySetInnerHTML` stays blocked, which is what the policy is for.
For your own inline scripts on those pages, use the nonce yourself:

```tsx
import { getCspNonce } from '@absolutejs/absolute';

<script nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: analytics }} />
```

In route handlers it's also in the context as `cspNonce`. External
`<script src>` tags you add to a framework page need it as well:
`'strict-dynamic'` ignores host allowlists.

## Customizing

```ts
secureHeaders({
	contentSecurityPolicy: {
		directives: {
			'img-src': ["'self'", 'https://images.example.com'],
			'style-src': ["'self'", 'https://fonts.googleapis.com'],
			'font-src': ["'self'", 'https://fonts.gstatic.com'],
			'object-src': false // remove a directive
		},
		reportOnly: true // Content-Security-Policy-Report-Only
	},
	frameAncestors: ["'none'"],
	permissionsPolicy: { camera: ['self'] },
	referrerPolicy: 'no-referrer',
	contentTypeOptions: false
});
```

Each directive you set replaces the default one; the nonce is still added
to `script-src` and `style-src`. `contentSecurityPolicy: false` sends no
policy and turns nonces off.

## Pre-rendered and ISR pages

A cached page can't carry a per-request nonce. When a page is pre-rendered
(or re-rendered by ISR) under `secureHeaders()`, the nonce that render used
is stored next to it. Each time the page is served, exactly that value is
replaced with the request's nonce, and the response gets that request's
policy. Markup injected into the page couldn't have known the render-time
nonce, so it stays blocked.

A page pre-rendered without `secureHeaders()` has no nonce on its scripts.
Under a nonce policy it would load with every script blocked. Instead, it is
served without a Content-Security-Policy header, and the server logs a
warning naming it. Rebuild with `secureHeaders()` in use to cover it.
