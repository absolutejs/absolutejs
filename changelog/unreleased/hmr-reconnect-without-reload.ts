import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "When the dev-server socket dropped, `absolute dev` pages polled for about 18 seconds and reloaded as soon as the server answered. On weak wifi every network change became a full reload, refetching every stylesheet and script and losing the page's state, and an outage longer than 18 seconds left the page disconnected until a manual reload. The page now reconnects the socket for up to 30 minutes, backing off from half a second to ten, waits for the network instead of retrying while the browser is offline, and retries at once when the network or the tab returns. It reloads only if it missed something: the server restarted, or sent an update while the page was away. The server now includes when it started and when it last sent an update in the manifest it sends each connecting page. The banner says when the browser is offline.",
	kind: 'fixed',
	summary:
		'Dev pages reconnect after a dropped connection without reloading, and keep trying through long outages'
};
