# Vendor prefixes and browser targets

Stylesheets get vendor prefixes automatically **when the project has
`autoprefixer` installed**:

```bash
bun add -d autoprefixer postcss
```

Nothing else is needed. Without it, CSS is emitted as written — exactly
as before.

## Choosing the browsers

```ts
// absolute.config.ts
export default defineConfig({
	browsers: ['last 2 versions', 'not dead']
});
```

`browsers` is a [browserslist](https://github.com/browserslist/browserslist)
query. Left out, the project's own browserslist config applies
(`browserslist` in `package.json`, or `.browserslistrc`), and `defaults`
if there is none.

To turn prefixing off while keeping `autoprefixer` installed for
something else:

```ts
export default defineConfig({ autoprefixer: false });
```

## What it covers

Every stylesheet the build compiles: plain CSS, Sass, Less, Stylus, CSS
modules and the per-component styles of Angular, Svelte and Vue. It runs
after the project's own PostCSS plugins.

If those plugins already include `autoprefixer`, the built-in one stands
down — a project that configured its own has made its own choice of
browsers.

## What it does not do

**It never removes a prefix.** Left to its default, `autoprefixer` also
deletes prefixes it considers outdated for the target browsers; it took a
hand-written `-webkit-backdrop-filter` out of the example app. Something
that runs without being asked for should not remove what the author
wrote, so this is add-only.

**It does not lower syntax.** Bun's CSS bundler already does that —
nesting, `oklch()`, range media queries, `color-mix()` — and has no
browser-target setting of its own, so `browsers` affects prefixes only.

## Why it is optional

Measured before deciding:

| | `autoprefixer` |
|---|---|
| once per process | 146 ms, almost all module loading |
| the example app's 13 stylesheets | 0.75 ms |
| one file, as on a dev edit | 0.17 ms |
| a 109 KB stylesheet | 4.4 ms |

Time was never the problem. Install size was: `autoprefixer` and its
dependencies are about 5.3 MB, 4.2 MB of it browser data, and always-on
prefixing would also have made `postcss` mandatory. As an optional peer —
the way Sass, Less and PostCSS already are — it costs nothing for a
project that does not want it.

The cost of that choice is that a project which never heard of the
option would ship unprefixed CSS silently. So when no prefixer is
installed and a stylesheet uses a property that needs one, the build
says so, once, naming the property and the file.

## A warning you may see

```
Browserslist: browsers data (caniuse-lite) is 8 months old.
```

That is browserslist's own message, not this framework's, and it is
worth acting on: which prefixes are added depends on that data.
`npx update-browserslist-db@latest` refreshes it.
