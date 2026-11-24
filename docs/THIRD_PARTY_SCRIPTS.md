# Third-party scripts

An analytics tag, a consent manager, a chat widget — with a loading
strategy, and run once however the visitor moves around the app.

```tsx
import { Script } from '@absolutejs/absolute/react/components';

<Script src="https://plausible.io/js/script.js" data={{ domain: 'x.com' }} />;
```

## What changed

There was no supported way to add one. No framework had a `<Script>`
component, and `generateHeadElement` rendered meta tags, preload links,
speculation rules and JSON-LD but had no option for a script. A project
wrote the tag into its own markup, and that is also how it ended up
running more than once.

**Measured, before this existed**: two pages that both carried one tag,
with its own counter. A soft navigation between them read 1, then 2, then
3 going back. A real analytics tag double-counts every pageview after the
first; a chat widget re-initialises.

## Strategies

| `strategy` | Where the tag goes | For |
| --- | --- | --- |
| `beforeInteractive` | in the document, undeferred | consent managers, bot and fraud checks, flicker guards |
| `afterInteractive` (default) | in the document with `defer` | analytics, tag managers |
| `lazyOnload` | added by the client after `load`, on an idle callback | chat widgets, support bubbles, social embeds |

`defer` and `async` are exclusive and `defer` is the default, because a
third-party tag that blocks parsing is the thing this exists to avoid.
`beforeInteractive` gets neither: a script asked to run before the page is
interactive cannot also be deferred.

## Identity is what stops a second run

Every tag carries `data-absolute-script`, its identity: `id` if given,
otherwise `src`.

A soft navigation recreates every executable script of the page being
swapped in — it has to, because that is how the incoming page's hydration
index mounts. So deduplication is keyed on this marker and **not** on
`src`: a page's own index has the same `src` on both sides of a navigation
and must run again.

When the live document is already running a script with that identity,
the **element is moved** into the new page rather than recreated. That
detail is load-bearing: the browser keeps an "already started" flag on the
script element itself, so a fresh node with identical attributes would
fetch and execute again.

A script the incoming page does **not** carry is kept too, appended to the
head. Two cases need it. A `lazyOnload` script is never in a page's markup
at all, so nothing claims it. And a visit from a page that carries a
script to one that does not and back again would otherwise re-run it on
arrival — the same double-count, two navigations later. Keeping the tag is
also simply true: the script has already run and its effects are in the
page, so removing the element unloads nothing, it only loses the record.

An inline script with no `id` has no identity and behaves like any other
inline script, which is to run per page. Two different snippets must not
collapse into one.

## Per framework

| | How |
| --- | --- |
| React | `<Script>`, or `<Head scripts={[…]}>` |
| Svelte | `<Head scripts={[…]}>` |
| Vue | `headTag: generateHeadElement({ scripts: […] })` |
| Angular | `generateHeadElement({ scripts: […] })` |
| HTML / HTMX | `generateHeadElement({ scripts: […] })` |

**Angular has no component form, and that is not an omission.** Its
template compiler drops a `<script>` element silently —
`preparseElement` returns `null` for one (`@angular/compiler`), with no
error — so a component could render the tag and nothing would appear. The
head is the only route.

A head rendered as a string has no component to run an effect later, so a
`lazyOnload` script there renders a small inline bootstrap that adds the
tag on `load`. It checks the document for the tag first, which is why it
is harmless that the bootstrap itself re-runs on each navigation.

## CSP

The tag gets the request's nonce. On a Svelte page that happens on the
server after rendering (`utils/cspNonceRef.ts`), because a Svelte
component compiles in your project and cannot read the server's nonce —
without it the tag would be rendered and then refused by the page's own
policy, which looks exactly like the script being broken.

## Not to be confused with `registerClientScript`

That takes a **function of yours** and serializes it into the page to run
after Angular hydration. This is for a third-party URL with a loading
strategy. Different problems.

## Escaping

Inline source and the bootstrap's values both sit inside a `<script>`
element, where a literal `</script` would close it early and spill the
rest of the page as markup. Both are neutralised. This is not
hypothetical in code pasted out of a tag manager.
