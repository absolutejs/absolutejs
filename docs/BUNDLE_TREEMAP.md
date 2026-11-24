# What a bundle is made of

```bash
absolute analyze --modules                  # the breakdown in the terminal
absolute analyze --treemap sizes.html       # the same data as a treemap
```

```
30 of 95 bundles carry a sourcemap · 682 KB

  @angular/compiler                   462 KB      68.4%   ████████████████████████
  .absolutejs/generated               64 KB       9.5%    ███·····················
  vue-router                          25 KB       3.7%    █·······················
  @absolutejs/devices                 25 KB       3.7%    █·······················

676 KB attributed to 90 modules in 17 groups · 5 KB unmapped (bundler glue)
```

## What changed

`absolute analyze` reported totals per **category** — pages, hydration,
client, islands, shared chunks, CSS. That answers "how big" and never "of
what". A 400KB page bundle that should be 90KB is a question about one
dependency, and `Pages 412 KB` cannot name it.

The first run of this on the example app said `@angular/compiler` is 462KB
— 68% of everything shipped to a browser — which is the kind of thing a
category total hides completely.

## Where the numbers come from

Bun's bundler does not report what went into an output, so the bytes are
attributed from the **sourcemap**. Every mapping segment names a source
file and a generated column, so the bytes between one segment and the next
belong to that source.

Measured on this repository's own example server bundle, that accounts for
**96.9% of 3.9MB across 1,325 sources**. The rest is reported as
`unmapped` rather than quietly dropped: a bundler's prelude and the glue
between modules belong to no source file, and leaving them out would make
the percentages add up to more than the bundle.

## Sourcemaps are required, and off by default

A production build emits none unless you ask:

```ts
export default defineConfig({ sourcemaps: 'external' });
```

With no maps the command says so and names the setting, rather than
printing an empty breakdown that reads as "your bundle contains nothing".

`'external'` deliberately **moves** the maps out of the served build into a
private `sourcemaps/` directory at the project root, keyed by each JS
file's basename, and strips the `sourceMappingURL` comment from the
shipped JS — so your source is not published. The report looks in both
places. Looking only beside the bundle found **1 of 96** maps here, the
server one, and reported every client bundle as having none.

Those private maps carry original source, so they are not for committing;
this repo's `.gitignore` has `/sourcemaps` for that reason.

## Grouping

A dependency groups under its package (`@absolutejs/auth`, `react-dom`),
and project source under its first two path segments (`src/core`). A
treemap of 1,325 files is a wall; a treemap of the 30 things that own them
is a report. A nested dependency groups under the package that actually
ships it — the innermost `node_modules` segment, not the outermost.

## The treemap file

A self-contained SVG page: no script, no CDN, no network. It has to open
from a `file://` path in a browser with nothing else available, which is
where a build artifact actually gets looked at.

Area is proportional to bytes — verified in a browser on the real report,
where the median error across 46 groups was **0.03 of a percentage
point**. Hovering a cell gives its exact size; cells too small for a
legible label are left unlabelled rather than overprinted.

## Budgets

The enforceable half of this already exists and is unchanged:
`absolute analyze --check` fails against the `sizeBudgets` in your config,
and `absolute ls --budget 50kb` fails on a single entry. This adds the
explanation, not the gate.
