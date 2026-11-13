import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`defineAction(path, { body, handler })` defines a form action: a POST route that checks the form against an Elysia `t.Object` schema and works with or without JavaScript. Without JavaScript a plain `<form method="post">` posts, the browser is sent back to the page (or to `redirect`) and the page shows the result: React and other SSR pages read it with `getActionState(action)` and pass it as a prop, and static HTML and HTMX pages get the errors, the success message and what the user typed written into `<form data-absolute-action>` by the server. With JavaScript, React\'s `useFormAction` hook (from `@absolutejs/absolute/react/hooks`) and `enhanceForms()` for plain pages (from `@absolutejs/absolute/client`) submit without a reload and expose pending, the typed result and one error message per field. HTMX `hx-post` forms get the action\'s `htmx` fragment, or behave like a plain post. Cross-site posts are refused (403), bodies over `maxBodySize` (default 10 MiB) are refused before they are read (413), and JSON clients such as Eden get JSON.',
	kind: 'added',
	summary:
		'Form actions: one handler for forms that work without JavaScript and update in place with it, on React, static HTML and HTMX pages'
};
