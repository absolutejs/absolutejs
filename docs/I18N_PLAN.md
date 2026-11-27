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

### The `i18n` config key

The routing half of that — which locales there are and how a request's is
chosen — can also be declared in `absolute.config.ts`, where the build and
the CLI can read it:

```ts
// src/i18n.routing.ts
import { defineI18nRouting } from '@absolutejs/absolute';

export const routing = defineI18nRouting({
	locales: ['en', 'fr', 'ar'],
	defaultLocale: 'en'
});

// absolute.config.ts
export default defineConfig({ i18n: routing });

// src/i18n.ts
export const i18n = defineI18n({ ...routing, messages: en, loaders });
```

With it, the sitemap lists every page once per locale without `sitemap.i18n`
saying the locales again, and `llms.txt` lists each page in the default
locale. `sitemap.i18n` still wins where it is given.

`defineI18n` is still given the routing itself, and has to be: the locale
types every `t()` and `payload()` is checked against come from the locales
written in that call, which a config read at run time cannot supply. So the
two are declared from one object, and `defineI18nRouting` makes it — it
returns what it is given, with the locales kept as literals. When they
differ anyway, the server says so at its first request, naming the settings:
the sitemap and the CLI go by the config, and requests are routed by
`defineI18n`.

### Links in the page's locale

The translator every framework hands a page (`useI18n()`, `getI18n()`,
`injectI18n()`) has `href()`, which writes a link to a page in the page's
own locale:

```tsx
const { t, href } = useI18n<typeof en>();

<Link href={href('/about')}>{t('nav.about')}</Link>      // /fr/about on a French page
<a href={href(currentPath, 'en')}>English</a>            // a language switcher
```

Under `prefix` it adds or swaps the locale segment, leaving the default
locale without one unless `prefixDefault` is set. Under `domain` a link to
another locale goes to that locale's host. Under `negotiate` every locale
shares one address, so it returns the path. A query and a fragment are
kept, and an address that is not a page of this site — another site, a
relative address, `mailto:`, a file — is returned as it is.

It works in the browser as on the server because the payload carries the
routing it needs (`routing` on the payload: the locales, and the strategy,
`prefixDefault` and domains only when they are not the defaults). A payload
made by hand has none, and its `href()` returns the path as given.

Links are not localized on their own, by design. A site written before this
has links such as `/fr/about` on its English pages — its language switcher —
and rewriting those to the page's locale would break exactly that link.
`localizeHref(href, locale, routing)` is the same thing as a function.

### Localized pathnames

A page's address can be written in each locale's own words:

```ts
export const routing = defineI18nRouting({
	locales: ['en', 'fr'],
	defaultLocale: 'en',
	pathnames: {
		'/about': { fr: '/a-propos' },
		'/blog/:slug': { fr: '/articles/:slug' }
	}
});
```

The table is keyed by the path a route is registered at, without a locale
prefix and with its `:params`; each locale named addresses the page at the
path given instead, with the same params. A locale not named uses the
route's own path. The route is registered once, as before
(`/:locale?/about`).

- `/fr/a-propos` is served by the route at `/fr/about`: the request is
  rewritten before any route is looked up, so it works for every kind of
  page, and the route sees `locale: 'fr'` as it always did.
- `/fr/about` redirects permanently to `/fr/a-propos`, so a page has one
  address per locale.
- `href()`, `localizePath`, the hreflang alternates and the sitemap all
  write the locale's own address. `href('/fr/a-propos', 'en')` is `/about`.
- A translation whose params are not the route's cannot be filled in from
  a request; the table is refused, with the reason, and nothing is
  rewritten.
- `absolute links` and a production build say when a path in the table has
  no route registered at it — a route that was renamed — and count a link
  to a locale's own address as a link to its route.

It is under the `prefix` strategy only, where the path says which locale an
address is in. The table is declared in the `i18n` config key, which the
server applies it from, and given to `defineI18n` too (`...routing`), which
writes links from it. It travels to the browser in the i18n payload, for
`href()`: a large table is on every localized page.

It is done with the app's own routing rules: the table becomes redirects
and rewrites, added after the app's, so one of the app's rules can still
answer for a path first.

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
| Vue | 2 ✅ | `provideI18n(payload)` / `useI18n<typeof en>()` via `provide`/`inject`, exported from `@absolutejs/absolute/vue`; the shell writes `lang`/`dir` from the request locale through `htmlLangAttributes()`, as Svelte's renderers do |
| Angular | 2 ✅ | `provideAbsoluteI18n(payload)` in the route's providers and `provideAbsoluteI18n()` in `angular.providers`, `injectI18n<typeof en>()` in a component or service, a pure `t` pipe, `LOCALE_ID` from the payload, and the shell's `lang`/`dir`. The payload reaches the browser through `TransferState`, not a page prop: Angular has no props channel, and `handler.providers` are SSR-only. There is no `I18nService` class — the translator is a provided value (`ABSOLUTE_I18N`), so the pipe can depend on it without a service to compile. |
| HTML / HTMX | 2 ✅ | Server-side substitution in the static page path (`src/core/htmlI18n.ts`): `data-i18n="key"` replaces the element's content, `data-i18n-attr="alt:key, title:key"` sets attributes, `data-i18n-params='{"n":2}'` carries ICU parameters, and `<html lang dir>` is filled in unless the author set `lang`. HTMX pages go through the same handler and so the same pass. Nothing happens without `i18nPlugin()`: no translator is registered, so the markup ships as written. The translator reaches it through `readRequestTranslate()` (`src/utils/localeRef.ts`), the same indirection the CSP nonce and the request locale use, because the static path has no route context. Build-time per-locale emission for fully static HTML is still Phase 3. |
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
- **`absolute i18n check <default> [locale…]`** (Phase 2 ✅ for a, b, c):
  reports (a) keys a locale never translated, (b) ICU argument mismatches
  against the default (`{count}` translated as `{n}`, which renders the
  literal `{n}`), and (c) unbalanced ICU braces in any catalog, which
  renders the message's own source. `--json` for CI. Non-zero exit on all
  three; a key the default does not have is reported and does not fail.
  Catalogs are **named on the command line**, not discovered: the config's
  `i18n` key declares the routing and not where the catalogs are, because
  `defineI18n` is called in app code. Discovering
  them would mean duplicating that declaration in the config or importing the
  server to find it — a decision worth making deliberately, not inside this
  command.
  - Still open: (d) unused keys, which needs the TypeScript AST for
    `t('…')`/`$t`/pipe usage *and* the `data-i18n` attributes HTML and HTMX
    pages now use (beta.226), with dynamic keys reported as "unknown, kept".
    Reporting a key as unused because it is only referenced from an HTML
    attribute would train people to ignore the tool.
  - Still open: `absolute i18n extract`, which writes missing keys as TODO
    stubs.
  - Note what `absolute typecheck` already covers, so this does not claim
    it: a loader typed `Translation<typeof en>` must carry every key with
    the right parameters. What it cannot see is a catalog read at runtime
    (`Bun.file('fr.json').json()` is `any`), and it does not parse ICU.

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
