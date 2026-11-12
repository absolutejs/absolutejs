import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'HTML and HTMX pages can share markup with `<abs-include src="../partials/header.html"></abs-include>`, which is replaced at build time with the file\'s contents. Paths are relative to the including file, and included files can include others. A layout marks where content goes with `<abs-slot>` and `<abs-slot name="head">`; a page fills the slots through the include\'s children and `<template slot="head">`. Includes are expanded before asset paths, image optimization and island rendering, so included markup gets all three. A missing file or an include cycle fails the build and shows the chain. Only the `.html` files directly in `pages/` are pages. In dev, editing a partial or layout updates every page that includes it. See docs/HTML_INCLUDES.md.',
	kind: 'added',
	summary:
		'Layouts and partials for HTML and HTMX pages with `<abs-include>` and `<abs-slot>`'
};
