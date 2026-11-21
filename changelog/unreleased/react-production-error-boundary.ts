import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'A render error on a production React page left the visitor with an empty document. The generated hydration index wrapped the page in an error boundary only in development, so in production the error reached the root, React unmounted it, and everything the visitor was reading disappeared with only a console message left behind — measured on a page whose heading and content were both gone. Production pages now have a boundary too: it reports the error and renders a plain fallback in place of the page, with a heading, a sentence and a reload button, marked `data-absolute-error="react"` and `role="alert"`. Development keeps its existing behaviour, the error overlay. Wiring an app\'s own `error` convention into the client boundary is a separate piece of work — it needs the convention compiled into the client bundle — so the built-in fallback is deliberately plain.',
	kind: 'fixed',
	summary: 'A render error no longer empties a production React page'
};
