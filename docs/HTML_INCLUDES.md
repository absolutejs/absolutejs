# Layouts and partials for HTML and HTMX pages

HTML and HTMX pages can share markup through build-time includes. The build
replaces each `<abs-include>` with the file it names, so the served page is
plain HTML. There's no runtime cost and no expression language.

## Partials

```html
<!-- html/pages/About.html -->
<body>
	<abs-include src="../partials/header.html"></abs-include>
	<main>…</main>
</body>
```

- `src` is relative to the file that contains the tag.
- Included files can include others.
- A self-closing `<abs-include src="…" />` works too.

## Layouts and slots

A layout marks where content goes with `<abs-slot>`. The default slot has
no name; others have a `name`. Whatever a slot contains is its fallback,
used when the page doesn't fill it.

```html
<!-- html/layouts/base.html -->
<!doctype html>
<html>
	<head>
		<abs-slot name="head"><title>My site</title></abs-slot>
		<link rel="stylesheet" href="../../styles/indexes/site.css" />
	</head>
	<body>
		<abs-include src="../partials/header.html"></abs-include>
		<main><abs-slot></abs-slot></main>
	</body>
</html>
```

A page fills the slots with the include's children. Put content for a named
slot in `<template slot="name">`; everything else goes to the default slot.

```html
<!-- html/pages/About.html -->
<abs-include src="../layouts/base.html">
	<template slot="head"><title>About us</title></template>
	<h1>About us</h1>
	<abs-include src="../partials/team.html"></abs-include>
</abs-include>
```

A layout can include another layout and pass its own slots on, for example
`<abs-include src="base.html"><article><abs-slot></abs-slot></article></abs-include>`.

## What counts as a page

Only the `.html` files directly inside `pages/` are pages: they get a
manifest entry and can be served with `handleHTMLPageRequest` /
`handleHTMXPageRequest`. Keep partials and layouts in a sibling directory
inside your HTML or HTMX directory, such as `html/partials/` and
`html/layouts/`. The dev server watches those, and they never become pages.

## Islands, assets and images

Includes are expanded before anything else processes the page, so included
markup gets everything a page's own markup gets:

- `<absolute-island>` tags are server-rendered and hydrated.
- Stylesheet and script links get their hashed paths. These links are
  matched by file name, so a relative path in a partial works wherever the
  partial is included.
- Images are optimized.

Root-relative URLs (`/assets/…`) are passed through unchanged, as in pages.

## Errors

A missing file or an include cycle fails the build, naming the chain:

```
Include cycle: html/partials/a.html includes itself
  include chain: html/pages/Loop.html → html/partials/a.html → html/partials/b.html → html/partials/a.html
```

## Dev

Editing a page live-updates it. Editing a partial or a layout live-updates
every page that includes it, directly or through another include. Each open
tab gets its own page, with its own slot content and the partial's new
text, so two tabs on two pages that share a layout both stay correct.

Text that a script changed on an element with an `id` (a counter, say) is
kept across live updates. Text you edit in the markup always shows the new
version, including on elements with an `id`.
