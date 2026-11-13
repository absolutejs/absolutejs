# Internationalization (i18n) plan

Status: Phase 1 implemented (locale routing, typed catalogs, React and Svelte
APIs, hreflang + per-locale sitemap). Phases 2–4 are proposals.

ROADMAP.md §15 lists i18n as "Nothing". This document is the design for all
of it and the record of what Phase 1 shipped.

## Goals and non-goals

Goals:

- One config describes the locales; the same object drives request locale
  resolution, link generation, hreflang, and the sitemap.
- Message keys **and ICU parameters** are type-checked from the default
  locale's catalog, with no codegen step.
- A page ships only one locale's messages, and only the namespaces it uses.
- Every framework AbsoluteJS renders gets an idiomatic translation API; HTML
  and HTMX pages get server-side substitution.
- No new runtime dependency: formatting runs on the platform's `Intl`.

Non-goals (for now): translation management/TMS sync, machine translation,
runtime locale switching without navigation, rich-text components (tags
inside messages) — Phase 4 at the earliest.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| ICU engine | In-house subset on `Intl.PluralRules`/`NumberFormat`/`DateTimeFormat` (~300 lines) | No dependency (intl-messageformat is ~40 kB and pulls `@formatjs/*`); the subset covers what apps use: arguments, `plural` (with `=N`, `offset:`, `#`), `selectordinal`, `select`, `number` (integer/percent/`::currency/XXX`), `date`/`time` styles, nesting, apostrophe quoting. Unsupported syntax renders the raw message rather than throwing. |
| Source of truth for types | The default locale's catalog, as a `.ts` module with `as const` / `defineMessages()` | Template-literal types extract keys and ICU parameters straight from the literal strings — no generated `.d.ts`, no build step. JSON catalogs still work but only type keys (TS widens JSON strings). |
| Other locales | `Translation<typeof en>` — same tree, `string` leaves | A missing key is a compile error at the catalog *and* at `defineI18n({ loaders })`. Runtime still deep-merges over the default catalog, so an untyped (JSON) gap degrades to the default language instead of a raw key. |
| Default catalog loading | Eager (`messages: en`), other locales lazy (`loaders: { fr: () => import('./fr') }`) | The default catalog is needed as the fallback anyway, and making it a value (not a loader) is what lets TS infer the catalog type without it being widened by the other locales. Loaders are bundle-friendly (static `import()` per locale; no template imports). |
| Locale in the request | Elysia plugin, `.derive('global')` → `locale` + `i18n` on the context; a `WeakMap<Request, …>` read through `getCurrentAbsoluteRequest()` for code without the context | Leaves `src/core/requestContext.ts` (shared) untouched. A `Symbol.for` getter (`src/utils/localeRef.ts`, the `cspNonceRef` pattern) lets render code that can't import the plugin (the Svelte document shell) read the locale. |
| Routing | Locale is the **first path segment**; users register `/:locale?/about` (Elysia 2 supports optional params) or `/:locale/about` | No URL rewriting inside Elysia (not supported without re-dispatching through `app.handle`, which double-runs every hook). The plugin 404s a `:locale` param that isn't a configured locale. |
| Hydration | The payload is an ordinary **page prop** (`props: { i18n: i18n.payload(['home']) }`) | It rides the existing `window.__INITIAL_PROPS__` script, which the page handlers already nonce (`nonceAttr()`/React's `nonce`) and escape (`escapeScriptContent` / React's bootstrap escaping). Phase 1 emits **no new inline script**. Any future standalone script (HTML pages, islands) must use `nonceAttr()` + `escapeScriptContent()`. |
| Typing in components | Explicit generic: `useI18n<typeof en>()`, `setI18n<typeof en>(payload)` | Framework context can't carry the catalog type. A global register interface (`declare module '@absolutejs/absolute/i18n' { interface I18nRegister … }`) is Phase 2; it needs the interface declared in that entry's own module, not re-exported. |
| hreflang | `Metadata.alternates: { hreflang, href }[]`, built by `i18n.alternates()` (absolute URLs + `x-default`) | One field rendered identically by `generateHeadElement`, React `<Head>`, and Svelte `<Head>`. |

## Config

```ts
// src/i18n.ts
import { defineI18n } from '@absolutejs/absolute';
import en from './messages/en'; // export default defineMessages({ … })

export const i18n = defineI18n({
	locales: ['en', 'fr', 'ar'],
	defaultLocale: 'en',
	messages: en,
	loaders: {
		fr: () => import('./messages/fr'),
		ar: () => import('./messages/ar')
	},
	strategy: 'prefix',     // 'prefix' | 'domain' | 'negotiate'
	prefixDefault: false,   // true → /en/about too; unprefixed paths negotiate
	redirect: false,        // with prefixDefault: 307 unprefixed navigations
	domains: { fr: 'example.fr', en: 'example.com' }, // 'domain' only
	cookieName: 'locale',
	localeParam: 'locale',
	baseUrl: 'https://example.com' // hreflang origin (default: request origin)
});
```

Strategies:

- **prefix** (default): first path segment if it is a locale; otherwise the
  default locale, or — with `prefixDefault` — cookie → `Accept-Language` →
  default, optionally redirecting page navigations (`GET`/`HEAD`, `Accept:
  text/html`, no file extension, not `/__*` or `/hmr`).
- **domain**: `Host` mapped through `domains`; unknown hosts (localhost)
  negotiate.
- **negotiate**: one URL for every locale; cookie → `Accept-Language` →
  default. No hreflang alternates (there is one URL).

Response headers: `Content-Language` always; `Vary: Accept-Language, Cookie`
whenever the locale came from negotiation (so shared caches and the page
cache key by it).

## Messages

```ts
// messages/en.ts
export default defineMessages({
	common: { greeting: 'Hello {name}' },
	cart: {
		count: '{count, plural, =0 {Your cart is empty} one {# item} other {# items}}'
	}
});
// messages/fr.ts
import type en from './en';
export default { … } satisfies Translation<typeof en>;
```

- `t('cart.count', { count: 2 })` — key and `{ count: number }` checked.
  Parameter types: `plural`/`selectordinal`/`number` → `number`; `date`/`time`
  → `Date | number`; `select` → `string`; plain `{x}` → `string | number |
  bigint | Date`. A message without arguments takes no params argument.
- Namespaces are the top-level keys. `i18n.payload(['cart', 'common'])` ships
  only those (merged over the default locale).
- Missing key at runtime → the key string, plus one `console.warn` per key.
- Missing param → `{name}` left visible. Malformed message → raw string.

## Per framework

| Framework | Phase | API |
| --- | --- | --- |
| Server (any) | 1 | `({ i18n, locale }) => i18n.t(…)`, `i18n.payload(ns)`, `i18n.alternates()`, `i18n.localizePath(path, locale?)`, `getRequestLocale()`; standalone `defineI18n(...).translator(locale)` for scripts/prerender |
| React | 1 | `<I18nProvider value={payload}>` + `useI18n<typeof en>()` from `@absolutejs/absolute/react/hooks`; the page renders `<html lang={i18n.locale} dir={i18n.dir}>` itself |
| Svelte | 1 | `const { t } = setI18n<typeof en>(i18n)` in the page, `getI18n<typeof en>()` in children (Svelte context) from `@absolutejs/absolute/svelte`; the document shell writes `<html lang dir>` from the request locale |
| Vue | 2 | `provideI18n(payload)` / `useI18n<typeof en>()` via `provide`/`inject`, exported from `@absolutejs/absolute/vue`; Vue shell `lang`/`dir` |
| Angular | 2 | `provideAbsoluteI18n(payload)` + an `I18nService` (signals: `locale`, `dir`, `t`) and a pure `t` pipe; SSR `LOCALE_ID` from the request; shell `lang`/`dir` |
| HTML / HTMX | 2 | Server-side substitution in the HTML page handlers: `data-i18n="key"` (text), `data-i18n-attr="title:key"`, `data-i18n-params='{"n":2}'`, run with the request translator before streaming; `<html lang dir>` filled in. HTMX fragments use the same pass. Build-time per-locale emission for fully static HTML is Phase 3. |
| Islands | 3 | Island props carry their own namespace payload; `createTypedIsland` gains an `i18n` option |
| Browser (any) | 1 | `@absolutejs/absolute/i18n`: `createTranslator`, `formatMessage`, `localizePath`, `localeDirection`, `negotiateLocale`, `alternateLinks` — for language switchers and vanilla scripts |

## Integration

- **Head**: `Metadata.alternates` → `<link rel="alternate" hreflang href>`
  (generateHeadElement escapes attributes; React/Svelte via JSX/Svelte).
  Phase 1 ✅.
- **Sitemap**: `sitemap.i18n = { locales, defaultLocale, strategy?,
  prefixDefault?, domains?, localeParam? }` in `absolute.config.ts`. Routes
  registered as `/:locale?/…`, `/:locale/…`, or a literal `/fr/…` collapse to
  their unprefixed path, then every page is listed once per locale with
  `xhtml:link` alternates and `x-default`. Phase 1 ✅. (The build-time route
  scanner `scanRouteRegistrations.ts` already sees `/:locale?/about` — no
  change needed.)
- **Prerender / ISR** (Phase 3): `static.routes` gains locale expansion
  (`'all'` crawls from each locale root; explicit lists get `localizePath`
  per locale), and the page cache keys on `Content-Language`/`Vary` for
  `negotiate`. Prerender runs requests through the plugin, so no special
  translation path is needed.
- **Intl formatting**: `formatNumber`, `formatDate`, `formatRelativeTime`,
  `formatList` on every translator; formatters cached per locale+options.
  Phase 1 ✅. Phase 2 adds `formatCurrency` sugar and timezone defaults
  (`config.timeZone`) so server and browser format dates identically.
- **RTL**: `localeDirection()` uses `Intl.Locale#maximize()` script subtags
  (Arab, Aran, Hebr, Thaa, Syrc, Nkoo, Adlm, Rohg, Mand, Samr) with a language
  fallback list — not `textInfo`, which Bun/JSC gets wrong for `az-Arab`.
  `dir` is on every payload/translator; the Svelte shell writes it. Phase 1 ✅.

## Tooling

- **Typecheck** (Phase 1 ✅ by construction): `absolute typecheck` fails on a
  missing key in any `Translation<typeof en>` catalog, an unknown key passed
  to `t()`, a missing/extra/wrongly-typed ICU parameter, and a `defineI18n`
  whose `loaders` miss a locale.
- **`absolute i18n`** (Phase 2): `absolute i18n check` loads the config's
  catalogs and reports (a) keys missing per locale (for JSON catalogs that
  the type system can't see), (b) parameter mismatches between a locale and
  the default (`{count}` translated as `{n}`), (c) ICU syntax errors, and (d)
  unused keys — found by scanning sources for `t('…')`/`$t`/pipe usage with
  the TypeScript AST (dynamic keys reported as "unknown, kept"). `--json` for
  CI; non-zero exit on missing/mismatch. `absolute i18n extract` writes
  missing keys as TODO stubs.

## Phases and exit criteria

### Phase 1 — routing, typed catalogs, React + Svelte, hreflang/sitemap ✅

Exit criteria (all met):

- `defineI18n` + `i18nPlugin` resolve the locale for prefix/domain/negotiate
  with cookie and Accept-Language; invalid `:locale` → 404; optional redirect;
  `Content-Language`/`Vary` headers.
- Typed keys and ICU params, compile errors for missing keys (type tests).
- ICU subset formatter with locale plural rules (unit tests incl. Arabic).
- React `I18nProvider`/`useI18n`, Svelte `setI18n`/`getI18n`; SSR and
  hydration from the same payload prop with no extra inline script.
- `Metadata.alternates` in all three head generators; per-locale sitemap.
- Packed-tarball e2e: a scaffolded app with React and Svelte localized pages
  in `absolute dev` and a production build (`hydrated` text matches SSR,
  `<html lang dir>`, hreflang links, sitemap entries).

### Phase 2 — Vue, Angular, HTML/HTMX; CLI; global typing

Exit: each framework has SSR+hydration tests and a scaffold e2e;
`absolute i18n check` catches the four classes above on a fixture with exit
codes; `I18nRegister` augmentation makes `useI18n()` typed without a generic.

### Phase 3 — static output and caching

Exit: `static.routes` prerenders every locale; ISR revalidates per locale;
islands get per-island namespaces; HTML pages can be emitted per locale at
build time; a dev-server edit to a catalog hot-reloads messages without a
server restart.

### Phase 4 — ergonomics

Rich text (`t.rich('k', { b: (chunks) => <b>{chunks}</b> })`), message
extraction from source, pseudo-localization for layout testing, and a
`<LocaleSwitcher>` per framework.

## Known limitations (Phase 1)

- The locale must be the first path segment under `prefix`.
- Type-level parameter extraction ignores apostrophe quoting (`'{x}'`); a
  quoted brace may be reported as a parameter.
- Catalogs are cached for the server's lifetime; editing a catalog in dev
  relies on the server restart the dev watcher already does for server files.
- A catalog whose only top-level key is `default` is read as a module
  (`{ default: catalog }`).
- The React page sets `<html lang dir>` itself (React owns the document).
