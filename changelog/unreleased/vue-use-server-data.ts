import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Vue pages could only get server data as props from the route handler. `useServerData(key, fetcher)`, exported from `@absolutejs/absolute/vue`, runs the fetcher while the page renders on the server and writes the result into the page, so hydration shows it without fetching again. A client-side route change, a page that exports `routes`, or `server: false` fetches in the browser instead. It returns `data`, `error`, `pending` and `refresh` refs, with `data` typed from the fetcher. A fetcher that throws on the server renders an error state rather than failing the page (in production the message sent to the browser is generic). Using one key twice in a request fails the page with a clear error outside production. Pages with `client: 'none'` render the data but write nothing into the page, and streaming pages are supported. Streaming-slot patches also no longer land inside the page's own inline scripts.",
	kind: 'added',
	summary:
		'Vue pages can load data on the server with `useServerData` and hydrate without a second fetch'
};
