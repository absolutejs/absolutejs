/* When the dev-server socket drops, the page used to poll for about 18
   seconds and reload as soon as the server answered. On weak wifi every
   network change became a full reload that refetched every stylesheet and
   script and lost the page's state, and an outage longer than 18 seconds
   left the page disconnected for good. Now the socket reconnects for as long
   as the page is open, and the page reloads only when it missed something:
   the server restarted, or the build changed while it was away. */

export const RECONNECT_BASE_DELAY_MS = 500;
export const RECONNECT_GIVE_UP_MS = 30 * 60_000;
export const RECONNECT_MAX_DELAY_MS = 10_000;

export const reconnectDelayMs = (attempt: number) =>
	Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);

/* What the server says about itself when a socket connects. */
export type ServerSnapshot = {
	/** When the last update went out to connected pages. */
	lastBroadcastAt?: number;
	/** When this server process started; a new value means it restarted. */
	serverStartedAt?: number;
};

/* Whether the page has to reload after reconnecting: the server restarted,
   or it sent an update after the last one this page received. Without a
   previous snapshot (the first connection) there is nothing to have missed;
   a server that does not say when it started counts as restarted, which is
   the old behavior. */
export const missedWhileDisconnected = (
	before: ServerSnapshot | undefined,
	after: ServerSnapshot,
	lastReceivedAt: number
) => {
	if (!before) return false;
	if (
		before.serverStartedAt === undefined ||
		before.serverStartedAt !== after.serverStartedAt
	)
		return true;

	return (after.lastBroadcastAt ?? 0) > lastReceivedAt;
};
