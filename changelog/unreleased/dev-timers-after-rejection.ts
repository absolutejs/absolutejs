import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Under `bun --hot`, Bun counts unhandled rejections that no listener claims and never resets the count; while it is non-zero Bun parks the process in a loop that still serves requests and delivers file-watch events but never runs timers. The server entry imports React pages, so saving a React component with a syntax error made Bun's hot reload reject, and from then on the HMR debounce never fired: every edit was detected and queued, including the one that fixed the error, and nothing rebuilt until the dev server restarted. An unhandled rejection in app code did the same. The dev server now claims unhandled rejections and prints them as before, so its timers keep running.",
	kind: 'fixed',
	summary:
		'`absolute dev` keeps rebuilding after a syntax error in a React component or an unhandled rejection'
};
