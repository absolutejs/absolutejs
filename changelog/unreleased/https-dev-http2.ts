import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "With `dev: { https: true }`, the dev server now also serves HTTP/2 on the same port (Bun 1.4.1+ `http2`), so the browser fetches page modules multiplexed over one connection instead of HTTP/1.1's six per origin, which matters most on import-heavy pages and remote dev hosts. The HMR WebSocket is unchanged: browsers open it as a separate HTTP/1.1 connection on the same port. Plain HTTP dev servers are unaffected.",
	kind: 'added',
	summary: 'The HTTPS dev server speaks HTTP/2'
};
