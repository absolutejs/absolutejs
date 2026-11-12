import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A project with Svelte pages but no Vue or Angular installed couldn't build any Svelte page, in dev or with `absolute build`: the non-React client pass failed with `Could not resolve: \"vue\"`, then `@angular/core`, `@angular/platform-browser` and `@angular/compiler`. The Svelte hydration index imports `@absolutejs/absolute/client`, whose island runtime lazily imports a hydrator per framework, and only the React client pass left frameworks the project doesn't have unresolved. The non-React, island and worker client passes, and the dev rebuilds of Svelte and Vue pages, now resolve a framework the project neither configures nor installs to a stub that throws only if that framework's hydrator runs. A bare external wouldn't do: dev island bundles aren't code-split, so Bun hoists the import and the browser can't load the bundle. An installed framework is bundled as before. Verified with a Svelte-only, a Vue-only, and an HTML project with a React island, each in `absolute dev`, `absolute start` and `absolute compile`.",
	kind: 'fixed',
	summary: "Pages build without the frameworks they don't use installed"
};
