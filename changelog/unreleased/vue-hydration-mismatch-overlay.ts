import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Vue recovers from a hydration mismatch by replacing the server\'s nodes, so in development the page usually still looks right while the cause ships, and the only sign was a console warning. In development a Vue page now collects Vue\'s hydration warnings (through `app.config.warnHandler`, chained after any handler a `setupApp` hook installs) and shows them on the error overlay after mount, with the usual causes: reading `window`, storage or a cookie during render, a teleport into an element of the page, a time or random value. Production is unchanged; Vue\'s own error still reaches the app\'s error reporting.',
	kind: 'added',
	summary: 'A Vue hydration mismatch shows on the development error overlay',
	symbols: []
};
