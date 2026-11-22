import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Two things embroidery-place's upgrade ran into. React route pages are split when a route's `element` is a const holding the JSX (`const ordersPage = (<AdminPage><OrdersView /></AdminPage>)`, reused by `/orders` and `/orders/:id`), not only when it is written inline: a name declared once in the file, as a const whose value is JSX, is followed. And the client boundary check accepts `typeof window` and `typeof document` as guards, alongside `typeof process`: `typeof window !== 'undefined' ? window.location.origin : process.env.SITE_URL` no longer fails the build.",
	kind: 'fixed',
	summary:
		'A route element held in a const is split; typeof window guards a process.env read'
};
